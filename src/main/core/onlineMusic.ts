import { execFile } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { promisify } from 'util';
import { app, session } from 'electron';

import { Innertube, UniversalCache } from 'youtubei.js';

import logger from '../logger';

const execFileAsync = promisify(execFile);

let innertubeClient: Innertube | null = null;

/**
 * Lazily initializes and caches the Innertube client singleton.
 * This must be called before any YouTube Music API interaction.
 */
async function getClient(): Promise<Innertube> {
  if (!innertubeClient) {
    logger.info('[OnlineSearch] Initializing Innertube client for online music...');
    innertubeClient = await Innertube.create({
      lang: 'en',
      location: 'US',
      retrieve_player: true,
      cache: new UniversalCache(false)
    });
    logger.info('[OnlineSearch] Innertube client initialized successfully.');
  }
  return innertubeClient;
}

/**
 * Searches YouTube Music for songs matching the query.
 *
 * @param query - The search string (song title, artist, etc.)
 * @returns Array of online song results with metadata
 */
export async function searchOnline(query: string): Promise<OnlineSongResult[]> {
  try {
    logger.info(`[OnlineSearch] Starting YouTube Music search for query: "${query}"`);
    const yt = await getClient();
    const searchResults = await yt.music.search(query, { type: 'song' });
    logger.info(`[OnlineSearch] YouTube Music API returned response for query: "${query}"`);

    const results: OnlineSongResult[] = [];

    if (searchResults.contents) {
      for (const shelf of searchResults.contents) {
        if (shelf.type === 'MusicShelf' && 'contents' in shelf) {
          const shelfContents = shelf.contents;
          if (Array.isArray(shelfContents)) {
            for (const item of shelfContents) {
              try {
                const parsed = parseSearchItem(item);
                if (parsed) results.push(parsed);
              } catch (parseError) {
                logger.debug('Failed to parse a search result item', { err: parseError });
              }
            }
          }
        }
      }
    }

    logger.info(`[OnlineSearch] Parsed ${results.length} valid song results for query: "${query}"`);
    return results;
  } catch (error) {
    logger.error('Failed to search online music', { err: error, query });
    return [];
  }
}

/**
 * Parses a single search result item into an OnlineSongResult.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSearchItem(item: any): OnlineSongResult | null {
  // MusicResponsiveListItem structure from youtubei.js
  if (!item) return null;

  const videoId =
    item.id ||
    item.video_id ||
    (item.endpoint?.payload?.videoId as string | undefined) ||
    (item.overlay?.content?.endpoint?.payload?.videoId as string | undefined);

  if (!videoId) return null;

  const title: string =
    typeof item.title === 'string'
      ? item.title
      : (item.title?.text ?? item.title?.toString() ?? 'Unknown Title');

  // Extract artists - could be in various fields depending on the item type
  let artists: string[] = [];
  if (item.artists && Array.isArray(item.artists)) {
    artists = item.artists.map((a: { name?: string; text?: string }) => a.name || a.text || '');
  } else if (item.subtitle?.text) {
    // Subtitle often contains "Artist • Album • Duration"
    const parts = (item.subtitle.text as string).split(' • ');
    if (parts.length > 0) {
      artists = [parts[0]];
    }
  }

  // Extract album
  let album: string | undefined;
  if (item.album?.name) {
    album = item.album.name;
  } else if (item.album?.text) {
    album = item.album.text;
  }

  // Extract duration (in seconds)
  let duration = 0;
  if (item.duration?.seconds != null) {
    duration = Number(item.duration.seconds);
  } else if (typeof item.duration === 'number') {
    duration = item.duration;
  } else if (item.duration?.text) {
    duration = parseDurationText(item.duration.text);
  }

  // Extract thumbnail
  let thumbnailUrl: string | undefined;
  if (item.thumbnails && Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    // Pick medium-sized thumbnail
    const thumb = item.thumbnails.length > 1 ? item.thumbnails[1] : item.thumbnails[0];
    thumbnailUrl = thumb.url;
  } else if (item.thumbnail?.contents && Array.isArray(item.thumbnail.contents)) {
    const thumb =
      item.thumbnail.contents.length > 1
        ? item.thumbnail.contents[1]
        : item.thumbnail.contents[0];
    thumbnailUrl = thumb?.url;
  }

  return {
    videoId,
    title,
    artists: artists.filter(Boolean),
    album,
    duration,
    thumbnailUrl
  };
}

/**
 * Parses a duration string like "3:45" or "1:02:30" into total seconds.
 */
function parseDurationText(text: string): number {
  const parts = text.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export function getYtDlpPath(): string {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const userDataPath = path.join(app.getPath('userData'), fileName);
  if (fs.existsSync(userDataPath)) {
    return userDataPath;
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(path.resolve(process.cwd()), fileName);
}

export async function isYtDlpInstalled(): Promise<boolean> {
  const ytDlpPath = getYtDlpPath();
  const exists = fs.existsSync(ytDlpPath);
  logger.info(`[OnlineStream] Checking if yt-dlp is installed. Path: "${ytDlpPath}" exists: ${exists}`);
  return exists;
}

export async function downloadYtDlp(event: Electron.IpcMainInvokeEvent): Promise<void> {
  const destDir = app.getPath('userData');
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const tempPath = path.join(destDir, `${fileName}.temp`);
  const finalPath = path.join(destDir, fileName);

  logger.info(`[OnlineStream] Starting download of yt-dlp to: "${finalPath}"`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      logger.error('[OnlineStream] Failed to delete existing temp file', { err: e });
    }
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`;

  return new Promise<void>((resolve, reject) => {
    const download = (downloadUrl: string) => {
      https.get(downloadUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            logger.info(`[OnlineStream] Redirecting yt-dlp download to: "${redirectUrl}"`);
            download(redirectUrl);
            return;
          } else {
            const err = new Error(`Redirect status ${response.statusCode} but no Location header found.`);
            logger.error('[OnlineStream] Redirect error', { err });
            reject(err);
            return;
          }
        }

        if (response.statusCode !== 200) {
          const err = new Error(`Failed to download: Server returned status code ${response.statusCode}`);
          logger.error('[OnlineStream] Download error', { err });
          reject(err);
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(tempPath);
        response.pipe(fileStream);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.round((downloadedBytes / totalBytes) * 100);
            event.sender.send('app/ytDlpDownloadProgress', progress);
          }
        });

        fileStream.on('finish', () => {
          fileStream.close((err) => {
            if (err) {
              logger.error('[OnlineStream] File stream close error', { err });
              reject(err);
              return;
            }
            try {
              if (fs.existsSync(finalPath)) {
                fs.unlinkSync(finalPath);
              }
              fs.renameSync(tempPath, finalPath);
              if (!isWindows) {
                try {
                  fs.chmodSync(finalPath, 0o755); // Make the downloaded binary executable on Linux/macOS
                  logger.info(`[OnlineStream] Successfully set executable permissions (0755) for "${finalPath}"`);
                } catch (chmodErr) {
                  logger.error('[OnlineStream] Failed to set executable permissions (chmod) for yt-dlp', { err: chmodErr });
                }
              }
              logger.info(`[OnlineStream] yt-dlp download completed and saved successfully to: "${finalPath}"`);
              resolve();
            } catch (renameError) {
              logger.error('[OnlineStream] Rename error after download', { err: renameError });
              reject(renameError);
            }
          });
        });

        fileStream.on('error', (err) => {
          logger.error('[OnlineStream] File stream error during download', { err });
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch (e) {}
          reject(err);
        });
      }).on('error', (err) => {
        logger.error('[OnlineStream] HTTP request error during download', { err });
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch (e) {}
        reject(err);
      });
    };

    download(url);
  });
}

export async function getOnlineStreamUrl(videoId: string): Promise<string> {
  try {
    logger.info(`[OnlineStream] Fetching stream URL for videoId: "${videoId}" using yt-dlp`);

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    const ytDlpPath = getYtDlpPath();

    if (!fs.existsSync(ytDlpPath)) {
      throw new Error(`yt-dlp executable not found at ${ytDlpPath}. Please download it or enable downloading.`);
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const userAgent = session.defaultSession.getUserAgent();
    const args = [
      '-g',
      '-f',
      'bestaudio[ext=webm]/bestaudio',
      '--user-agent',
      userAgent,
      videoUrl
    ];
    const { stdout, stderr } = await execFileAsync(ytDlpPath, args);

    if (stderr && !stdout) {
      logger.warn(`yt-dlp stderr: ${stderr}`);
    }

    const streamUrl = stdout.split('\n').map(line => line.trim()).find(line => line.startsWith('http'));
    if (!streamUrl) {
      logger.warn(`yt-dlp stdout: ${stdout}`);
      throw new Error('yt-dlp returned an empty or invalid stream URL');
    }

    logger.info(`[OnlineStream] Successfully resolved stream URL via yt-dlp for videoId: "${videoId}"`);
    return streamUrl;
  } catch (error) {
    logger.error('Failed to get online stream URL with yt-dlp', { err: error, videoId });
    throw new Error(`ONLINE_STREAM_FAILED: Could not resolve stream for video ${videoId}`);
  }
}

export async function loginToYouTube(
  onPending: (data: { verification_url: string; user_code: string }) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then((yt) => {
        const handlePending = (data: { verification_url: string; user_code: string }) => {
          logger.info(`[OAuth] Auth pending. URL: ${data.verification_url}, Code: ${data.user_code}`);
          onPending({
            verification_url: data.verification_url,
            user_code: data.user_code
          });
        };

        const handleAuth = (data: any) => {
          logger.info('[OAuth] Authentication successful', data);
          cleanup();
          resolve();
        };

        const handleAuthError = (error: any) => {
          logger.error('[OAuth] Authentication error', { err: error });
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          (yt.session as any).removeListener('auth-pending', handlePending);
          (yt.session as any).removeListener('auth', handleAuth);
          (yt.session as any).removeListener('auth-error', handleAuthError);
        };

        // Remove any existing listeners first
        (yt.session as any).removeAllListeners('auth-pending');
        (yt.session as any).removeAllListeners('auth');
        (yt.session as any).removeAllListeners('auth-error');

        // Register new listeners
        (yt.session as any).on('auth-pending', handlePending);
        (yt.session as any).on('auth', handleAuth);
        (yt.session as any).on('auth-error', handleAuthError);

        yt.session.oauth.init().catch((err) => {
          logger.error('Failed to initiate YouTube login oauth init', { err });
          cleanup();
          reject(err);
        });
      })
      .catch((error) => {
        logger.error('Failed to initiate YouTube login getClient', { err: error });
        reject(error);
      });
  });
}

export async function isYouTubeLoggedIn(): Promise<boolean> {
  try {
    const yt = await getClient();
    return yt.session.logged_in;
  } catch {
    return false;
  }
}

// Session cache for online songs to make them playable via standard queue logic
const onlineSongsCache = new Map<number, AudioPlayerData>();
let nextOnlineSongId = -1001;

const cacheFilePath = path.join(app.getPath('userData'), 'onlineSongsCache.json');
const listenedSongsFilePath = path.join(app.getPath('userData'), 'onlineListenedSongs.json');

function saveCacheToDisk() {
  try {
    const data = JSON.stringify(Array.from(onlineSongsCache.entries()));
    fs.writeFile(cacheFilePath, data, 'utf-8', (err) => {
      if (err) {
        logger.error('[onlineSongsCache] Failed to save online songs cache to disk', { err });
      }
    });
  } catch (error) {
    logger.error('[onlineSongsCache] Failed to serialize online songs cache', { err: error });
  }
}

function loadCacheFromDisk() {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const data = fs.readFileSync(cacheFilePath, 'utf-8');
      const entries = JSON.parse(data);
      if (Array.isArray(entries)) {
        for (const [id, song] of entries) {
          onlineSongsCache.set(Number(id), song);
          if (Number(id) < nextOnlineSongId) {
            nextOnlineSongId = Number(id) - 1;
          }
        }
        logger.info(`[onlineSongsCache] Successfully restored ${onlineSongsCache.size} online songs from disk`);
      }
    }
  } catch (error) {
    logger.error('[onlineSongsCache] Failed to load online songs cache from disk', { err: error });
  }
}

const onlineListenedSongs: AudioPlayerData[] = [];

export function addToOnlineListenedSongs(song: AudioPlayerData) {
  try {
    // Remove existing duplicate by onlineVideoId
    const index = onlineListenedSongs.findIndex(
      (s) => s.onlineVideoId === song.onlineVideoId
    );
    if (index !== -1) {
      onlineListenedSongs.splice(index, 1);
    }

    // Clean path to avoid saving expired dynamic youtube stream URL in history
    const songToSave = {
      ...song,
      path: '' // Exclude the dynamic stream URL path as it expires
    };

    // Add to front of the list
    onlineListenedSongs.unshift(songToSave);

    // Limit to 15 songs
    if (onlineListenedSongs.length > 15) {
      onlineListenedSongs.pop();
    }

    // Save to disk
    saveOnlineListenedSongsToDisk();
  } catch (error) {
    logger.error('[onlineMusic] Failed to add online listened song', { err: error });
  }
}

export function getOnlineListenedSongs(): AudioPlayerData[] {
  return onlineListenedSongs;
}

export function removeFromOnlineListenedSongs(songId: number): boolean {
  try {
    const index = onlineListenedSongs.findIndex((s) => s.songId === songId);
    if (index !== -1) {
      onlineListenedSongs.splice(index, 1);
      saveOnlineListenedSongsToDisk();
      logger.info(`[onlineMusic] Removed song with ID ${songId} from online listened history`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('[onlineMusic] Failed to remove song from online listened history', { err: error });
    return false;
  }
}

function saveOnlineListenedSongsToDisk() {
  try {
    const data = JSON.stringify(onlineListenedSongs, null, 2);
    fs.writeFile(listenedSongsFilePath, data, 'utf-8', (err) => {
      if (err) logger.error('[onlineMusic] Failed to save online listened songs', { err });
    });
  } catch (error) {
    logger.error('[onlineMusic] Failed to serialize online listened songs', { err: error });
  }
}

function loadOnlineListenedSongsFromDisk() {
  try {
    if (fs.existsSync(listenedSongsFilePath)) {
      const data = fs.readFileSync(listenedSongsFilePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        onlineListenedSongs.push(...parsed);
        // Make sure all these loaded history songs are also in the cache Map
        for (const song of parsed) {
          if (song.songId && !onlineSongsCache.has(song.songId)) {
            onlineSongsCache.set(song.songId, song);
          }
        }
        logger.info(`[onlineMusic] Successfully loaded ${onlineListenedSongs.length} online listened songs from disk`);
      }
    }
  } catch (error) {
    logger.error('[onlineMusic] Failed to load online listened songs', { err: error });
  }
}

// Load persisted cache on startup
loadCacheFromDisk();
loadOnlineListenedSongsFromDisk();

/**
 * Caches an online song and returns a unique negative ID.
 * If the song is already cached (by videoId), returns its existing negative ID.
 */
export function cacheOnlineSong(song: AudioPlayerData | OnlineSongResult): number {
  const videoId = 'onlineVideoId' in song && song.onlineVideoId ? song.onlineVideoId : (song as OnlineSongResult).videoId;
  
  if (!videoId) {
    logger.warn('[onlineSongsCache] Attempted to cache online song without videoId');
    return -1;
  }

  // Check if already cached
  for (const [id, cachedSong] of onlineSongsCache.entries()) {
    if (cachedSong.onlineVideoId === videoId) {
      return id;
    }
  }

  let cacheId: number;
  let cachedData: AudioPlayerData;
  if ('songId' in song && song.songId < 0 && song.songId !== -1) {
    // If it's already an assigned negative ID (not the default -1), reuse it
    cacheId = song.songId;
    cachedData = {
      ...song
    };
  } else if ('songId' in song) {
    cacheId = nextOnlineSongId--;
    cachedData = {
      ...song,
      songId: cacheId
    };
  } else {
    // Convert OnlineSongResult to AudioPlayerData
    cacheId = nextOnlineSongId--;
    cachedData = {
      songId: cacheId,
      title: song.title,
      artists: song.artists.map((name, idx) => ({
        artistId: -(idx + 1), // Assign temporary negative ID
        name
      })),
      duration: song.duration,
      artworkPath: song.thumbnailUrl,
      path: '', // Resolved dynamically when played
      isAFavorite: false,
      isKnownSource: false,
      isBlacklisted: false,
      isOnlineStream: true,
      onlineVideoId: videoId
    };
  }

  onlineSongsCache.set(cacheId, cachedData);
  logger.debug(`[onlineSongsCache] Cached online song: "${cachedData.title}" with ID: ${cacheId}`);
  saveCacheToDisk();
  return cacheId;
}

/**
 * Retrieves a cached online song by its negative ID.
 */
export function getOnlineSongFromCache(id: number): AudioPlayerData | undefined {
  return onlineSongsCache.get(id);
}

/**
 * Fetches recommended similar songs for a given videoId from YouTube Music.
 */
export async function getOnlineRecommendations(videoId: string): Promise<OnlineSongResult[]> {
  try {
    logger.info(`[OnlineRecommendations] Fetching recommendations for videoId: "${videoId}"`);
    const yt = await getClient();
    const upNext = await yt.music.getUpNext(videoId);
    
    const results: OnlineSongResult[] = [];
    if (upNext.contents) {
      for (const item of upNext.contents) {
        // Safe check for PlaylistPanelVideo or its wrapper
        const isVideo = item.type === 'PlaylistPanelVideo' || 
                        item.type === 'PlaylistPanelVideoWrapper' || 
                        ('video_id' in item && 'title' in item) ||
                        ('video' in item);
                        
        if (isVideo) {
          const video = (item as any).video || item;
          const itemVideoId = video.video_id || video.id;
          
          if (!itemVideoId) continue;

          const title = typeof video.title === 'string' 
            ? video.title 
            : (video.title?.text ?? 'Unknown Title');
          
          // Extract artists
          let artists: string[] = [];
          if (video.artists && Array.isArray(video.artists)) {
            artists = video.artists.map((a: any) => a.name || a.text || '');
          } else if (video.author?.name) {
            artists = [video.author.name];
          }
          
          // Extract duration
          let duration = 0;
          if (video.duration?.seconds != null) {
            duration = Number(video.duration.seconds);
          }
          
          // Extract thumbnail
          let thumbnailUrl: string | undefined;
          if (video.thumbnail && Array.isArray(video.thumbnail) && video.thumbnail.length > 0) {
            thumbnailUrl = video.thumbnail[0].url;
          } else if (video.thumbnails && Array.isArray(video.thumbnails) && video.thumbnails.length > 0) {
            thumbnailUrl = video.thumbnails[0].url;
          }
          
          results.push({
            videoId: itemVideoId,
            title,
            artists: artists.filter(Boolean),
            duration,
            thumbnailUrl
          });
        }
      }
    }
    
    // Filter out the seed video if it's in the results
    const filteredResults = results.filter(song => song.videoId !== videoId);
    
    logger.info(`[OnlineRecommendations] Found ${filteredResults.length} recommended songs for videoId: "${videoId}"`);
    return filteredResults;
  } catch (error) {
    logger.error('Failed to fetch online recommendations', { err: error, videoId });
    return [];
  }
}
