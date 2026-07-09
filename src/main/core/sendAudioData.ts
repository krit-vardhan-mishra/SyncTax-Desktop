import { addSongToPlayHistory } from '@main/db/queries/history';
import { getPlayableSongById } from '@main/db/queries/songs';
import { getOnlineSongFromCache, getOnlineStreamUrl, addToOnlineListenedSongs, searchOnline } from './onlineMusic';
import { setDiscordRpcActivity } from '@main/other/discordRPC';
import sharp from 'sharp';

import {
  parseArtistOnlineArtworks,
  parseSongArtworks,
  removeDefaultAppProtocolFromFilePath,
  resolveSongFilePath
} from '../fs/resolveFilePaths';
import logger from '../logger';
import { IS_DEVELOPMENT, setCurrentSongPath } from '../main';
import { parsePaletteFromArtworks } from './getAllSongs';

export const parseArtworkDataForAudioPlayerData = (artworkData?: Buffer | Uint8Array) => {
  if (artworkData === undefined) return undefined;

  if (IS_DEVELOPMENT) return Buffer.from(artworkData).toString('base64');
  return artworkData;
};

// const getRelevantArtistData = (
//   songArtists?: {
//     artistId: string;
//     name: string;
//   }[]
// ) => {
//   const artists = getArtistsData();
//   const relevantArtists: {
//     artistId: string;
//     artworkName?: string;
//     name: string;
//     onlineArtworkPaths?: OnlineArtistArtworks;
//   }[] = [];

//   if (songArtists) {
//     for (const songArtist of songArtists) {
//       for (const artist of artists) {
//         if (artist.artistId === songArtist.artistId) {
//           if (!artist.onlineArtworkPaths)
//             getArtistInfoFromNet(artist.artistId).catch((error) =>
//               logger.warn('Failed to get artist info from net', { err: error })
//             );

//           const { artistId, name, artworkName, onlineArtworkPaths } = artist;

//           relevantArtists.push({
//             artistId,
//             name,
//             artworkName,
//             onlineArtworkPaths
//           });
//         }
//       }
//     }
//   }

//   return relevantArtists;
// };

const getArtworkBuffer = async (artworkPath: string) => {
  try {
    const realPath = removeDefaultAppProtocolFromFilePath(artworkPath);
    const buffer = await sharp(realPath).toBuffer();

    return buffer;
  } catch {
    // Failed to get artwork buffer most probably becuase the artwork path is a packaged path
    return undefined;
  }
};

const fetchOnlineArtworkBuffer = async (url: string): Promise<Buffer | undefined> => {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    logger.warn(`[sendAudioData] Failed to fetch online artwork from ${url}: ${res.statusText}`);
  } catch (error) {
    logger.error(`[sendAudioData] Error fetching online artwork from ${url}:`, { error });
  }
  return undefined;
};

const sendAudioData = async (songId: number): Promise<AudioPlayerData> => {
  logger.debug(`Fetching song data for song id -${songId}-`);
  if (songId < 0) {
    logger.debug(`Detected negative song ID: ${songId}. Checking online cache...`);
    const cachedSong = getOnlineSongFromCache(songId);
    if (cachedSong) {
      try {
        logger.info(`[sendAudioData] Resolving fresh stream URL for online song: "${cachedSong.title}" (${cachedSong.onlineVideoId})`);
        
        const [freshStreamUrl, artworkBuffer] = await Promise.all([
          getOnlineStreamUrl(cachedSong.onlineVideoId!),
          cachedSong.artworkPath ? fetchOnlineArtworkBuffer(cachedSong.artworkPath) : Promise.resolve(undefined)
        ]);
        cachedSong.path = freshStreamUrl;
        if (artworkBuffer) {
          cachedSong.artwork = parseArtworkDataForAudioPlayerData(artworkBuffer);
        }
        
        // Update Discord RPC activity
        const now = Date.now();
        setDiscordRpcActivity({
          details: `Listening to '${cachedSong.title}'`,
          state: `By ${cachedSong.artists?.map((artist) => artist.name).join(', ') || 'Unknown Artist'}`,
          largeImageKey: 'synctax_logo',
          smallImageKey: 'song_artwork',
          startTimestamp: now,
          endTimestamp: now + cachedSong.duration * 1000
        });

        // Add to online list history (excluding recommendations)
        addToOnlineListenedSongs(cachedSong);
        
        return cachedSong;
      } catch (streamError) {
        logger.error(`[sendAudioData] Failed to resolve stream URL for cached online song ${songId}`, { err: streamError });
        throw new Error('SONG_DATA_SEND_FAILED' as ErrorCodes);
      }
    } else {
      logger.error(`[sendAudioData] Online song not found in cache for ID: ${songId}`);
      throw new Error('SONG_NOT_FOUND' as ErrorCodes);
    }
  }
  try {
    const song = await getPlayableSongById(songId);

    if (song) {
      const artists: AudioPlayerData['artists'] =
        song.artists?.map((a) => ({
          artistId: a.artist.id,
          name: a.artist.name,
          onlineArtworkPaths: parseArtistOnlineArtworks(a.artist.artworks.map((aw) => aw.artwork))
        })) ?? [];

      const artworks = song.artworks.map((a) => a.artwork);
      const artworkPaths = parseSongArtworks(artworks);
      const songArtwork = artworkPaths.artworkPath;
      const artworkData = await getArtworkBuffer(songArtwork);

      const albumObj = song.albums?.[0]?.album;
      const album = albumObj ? { albumId: albumObj.id, name: albumObj.title } : undefined;
      const isBlacklisted = song.isBlacklisted;
      const isAFavorite = song.isFavorite;

      let resolvedPath = song.path;
      if (song.path.startsWith('online://')) {
        try {
          if (song.path.startsWith('online://youtube/')) {
            const videoId = song.path.replace('online://youtube/', '');
            resolvedPath = await getOnlineStreamUrl(videoId);
          } else if (song.path.startsWith('online://spotify/')) {
            const encodedQuery = song.path.replace('online://spotify/', '');
            const query = decodeURIComponent(encodedQuery);
            logger.info(`[sendAudioData] Resolving Spotify song via YouTube Music search: "${query}"`);
            const searchResults = await searchOnline(query);
            if (searchResults.length === 0 || !searchResults[0].videoId) {
              throw new Error(`No YouTube match found for Spotify track: "${query}"`);
            }
            const videoId = searchResults[0].videoId;
            resolvedPath = await getOnlineStreamUrl(videoId);
          }
        } catch (err) {
          logger.error(`[sendAudioData] Failed to resolve online song path: ${song.path}`, { err });
          throw new Error('SONG_DATA_SEND_FAILED' as ErrorCodes);
        }
      } else {
        resolvedPath = resolveSongFilePath(song.path);
      }

      const isOnline = song.path.startsWith('online://');
      const data: AudioPlayerData = {
        title: song.title,
        artists,
        duration: Number(song.duration),
        artwork: parseArtworkDataForAudioPlayerData(artworkData),
        artworkPath: songArtwork,
        path: resolvedPath,
        songId: song.id,
        isAFavorite,
        album,
        paletteData: parsePaletteFromArtworks(artworks),
        isKnownSource: true, // this is always true here because the song is from the library
        isBlacklisted,
        isOnlineStream: isOnline,
        onlineVideoId: isOnline && song.path.startsWith('online://youtube/')
          ? song.path.replace('online://youtube/', '')
          : undefined
      };

      addSongToPlayHistory(songId);

      const now = Date.now();
      setDiscordRpcActivity({
        details: `Listening to '${data.title}'`,
        state: `By ${data.artists?.map((artist) => artist.name).join(', ')}`,
        largeImageKey: 'synctax_logo',
        smallImageKey: 'song_artwork',
        startTimestamp: now,
        endTimestamp: now + data.duration * 1000
      });
      setCurrentSongPath(song.path);

      return data;
    }
    logger.error(`No matching song to send audio data`, { audioId: songId });
    throw new Error('SONG_NOT_FOUND' as ErrorCodes);
  } catch (error) {
    logger.error(`Failed to send songs data.`, { err: error });
    throw new Error('SONG_DATA_SEND_FAILED' as ErrorCodes);
  }
};

export default sendAudioData;
