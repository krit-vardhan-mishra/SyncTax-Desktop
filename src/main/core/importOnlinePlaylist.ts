import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { songs, playlists, playlistsSongs, artists, artistsSongs, artworks, artworksSongs, artworksPlaylists } from '../db/schema';
import { getYtDlpPath } from './onlineMusic';
import { sendMessageToRenderer } from '../main';
import logger from '../logger';
import { createPlaylist, linkSongsWithPlaylist } from '../db/queries/playlists';

const execFileAsync = promisify(execFile);

interface PlaylistItem {
  title: string;
  artist: string;
  duration: number; // in seconds
  path: string; // online://...
  thumbnail?: string; // remote HTTP/HTTPS image URL
}

async function getOrCreateArtist(artistName: string, trx: DB | DBTransaction = db): Promise<number> {
  const trimmedName = artistName.trim();
  const existing = await trx.query.artists.findFirst({
    where: eq(artists.name, trimmedName)
  });

  if (existing) {
    return existing.id;
  }

  const [newArtist] = await trx
    .insert(artists)
    .values({ name: trimmedName })
    .returning({ id: artists.id });

  return newArtist.id;
}

export async function importOnlinePlaylist(
  playlistUrl: string,
  playlistType: 'youtube' | 'spotify',
  customName?: string
) {
  try {
    logger.info(`Starting online playlist import. Type: ${playlistType}, URL: ${playlistUrl}`);
    let playlistName = customName?.trim() || 'Imported Playlist';
    let playlistCover: string | undefined = undefined;
    let tracks: PlaylistItem[] = [];

    if (playlistType === 'youtube') {
      let ytDlpPath = getYtDlpPath();
      if (!fs.existsSync(ytDlpPath)) {
        // Fallback to checking global path if not found locally
        ytDlpPath = 'yt-dlp';
      }

      // Run yt-dlp to dump flat playlist metadata JSON
      const args = ['--flat-playlist', '--dump-single-json', playlistUrl];

      const { stdout } = await execFileAsync(ytDlpPath, args, { maxBuffer: 10 * 1024 * 1024 });
      const metadata = JSON.parse(stdout);

      if (metadata.title) {
        playlistName = customName?.trim() || metadata.title;
      }

      if (metadata.thumbnails && Array.isArray(metadata.thumbnails) && metadata.thumbnails.length > 0) {
        playlistCover = metadata.thumbnails[metadata.thumbnails.length - 1]?.url || metadata.thumbnail || undefined;
      } else if (metadata.thumbnail) {
        playlistCover = metadata.thumbnail;
      }

      if (metadata.entries && Array.isArray(metadata.entries)) {
        for (const entry of metadata.entries) {
          if (!entry.id) continue;

          let artist = entry.uploader || entry.artist || 'Unknown Artist';
          let title = entry.title || 'Unknown Track';
          
          // Smart parsing fallback for video titles in "Artist - Title" format
          if (artist === 'Unknown Artist' && title.includes(' - ')) {
            const parts = title.split(' - ');
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          }

          let thumbnail = entry.thumbnails?.[0]?.url || entry.thumbnail || undefined;
          tracks.push({
            title,
            artist,
            duration: entry.duration || 0,
            path: `online://youtube/${entry.id}`,
            thumbnail
          });
        }
      }
    } else if (playlistType === 'spotify') {
      let embedUrl = playlistUrl;
      const playlistIdMatch = playlistUrl.match(/\/playlist\/([a-zA-Z0-9]+)/);
      if (playlistIdMatch) {
        embedUrl = `https://open.spotify.com/embed/playlist/${playlistIdMatch[1]}`;
      }

      const res = await fetch(embedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch Spotify embed page: ${res.statusText}`);
      }
      const html = await res.text();

      // Extract JSON hydration payload inside Spotify embed page
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextDataMatch) {
        throw new Error('Could not parse Spotify playlist data from embed page (NEXT_DATA missing)');
      }

      const parsedData = JSON.parse(nextDataMatch[1]);
      const data = parsedData?.props?.pageProps?.state?.data;
      if (!data || !data.entity) {
        throw new Error('Spotify playlist data missing in payload structure');
      }

      const entity = data.entity;
      playlistName = customName?.trim() || entity.name || entity.title || 'Spotify Playlist';
      playlistCover = entity.coverArt?.sources?.[0]?.url || undefined;

      const tracksList = entity.trackList || [];
      for (const track of tracksList) {
        const title = track.title || 'Unknown Track';
        const artist = track.subtitle || 'Unknown Artist';
        const duration = track.duration ? track.duration / 1000 : 0;
        const thumbnail = entity.coverArt?.sources?.[0]?.url || undefined;

        // Encode track and artist in the path so we can search YouTube when played
        const encodedQuery = encodeURIComponent(`${artist} - ${title}`);
        tracks.push({
          title,
          artist,
          duration,
          path: `online://spotify/${encodedQuery}`,
          thumbnail
        });
      }
    }

    if (tracks.length === 0) {
      throw new Error('No tracks found in the specified playlist.');
    }

    // Now insert them into the DB inside a single transaction
    const result = await db.transaction(async (trx) => {
      // 1. Create the playlist record
      const newPlaylist = await createPlaylist(playlistName, trx);

      // 2. Resolve or create artists, insert songs, and build junctions
      const now = new Date();
      const songIds: number[] = [];

      for (const track of tracks) {
        // Check if the song with this path already exists in the database
        const existingSong = await trx.query.songs.findFirst({
          where: eq(songs.path, track.path)
        });

        let songId: number;

        if (existingSong) {
          songId = existingSong.id;
        } else {
          // Find or create artist first
          const artistId = await getOrCreateArtist(track.artist, trx);

          // Insert song record
          const [newSong] = await trx
            .insert(songs)
            .values({
              title: track.title,
              duration: track.duration.toFixed(3),
              path: track.path,
              fileCreatedAt: now,
              fileModifiedAt: now,
              folderId: null, // Virtual online song
              isFavorite: false,
              isBlacklisted: false
            })
            .returning({ id: songs.id });

          songId = newSong.id;

          // Link song with artist
          await trx.insert(artistsSongs).values({
            songId: newSong.id,
            artistId: artistId
          });

          // Insert remote artwork if available and link it
          if (track.thumbnail) {
            const [newArtwork] = await trx
              .insert(artworks)
              .values({
                path: track.thumbnail,
                source: 'REMOTE',
                width: 0,
                height: 0
              })
              .returning({ id: artworks.id });

            await trx.insert(artworksSongs).values({
              songId: newSong.id,
              artworkId: newArtwork.id
            });
          }
        }

        songIds.push(songId);
      }

      // Link playlist artwork if available
      if (playlistCover) {
        const [newPlaylistArtwork] = await trx
          .insert(artworks)
          .values({
            path: playlistCover,
            source: 'REMOTE',
            width: 0,
            height: 0
          })
          .returning({ id: artworks.id });

        await trx.insert(artworksPlaylists).values({
          playlistId: newPlaylist.id,
          artworkId: newPlaylistArtwork.id
        });
      }

      // 3. Link songs to playlist
      await linkSongsWithPlaylist(songIds, newPlaylist.id, trx);

      return { playlistId: newPlaylist.id, count: songIds.length };
    });

    logger.info(
      `Successfully imported online playlist '${playlistName}' with ${result.count} tracks.`
    );
    sendMessageToRenderer({
      messageCode: 'PLAYLIST_IMPORT_SUCCESS',
      data: { name: playlistName, count: result.count }
    });

    return { success: true, playlistName, count: result.count };
  } catch (error: any) {
    logger.error('Failed to import online playlist', { error });
    sendMessageToRenderer({
      messageCode: 'PLAYLIST_IMPORT_FAILED',
      data: { error: error.message || error }
    });
    throw error;
  }
}
