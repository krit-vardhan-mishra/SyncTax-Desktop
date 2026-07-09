import type { Subscription } from '@tanstack/react-store';

import { dispatch, store } from '../store/store';
import storage from '../utils/localStorage';
import { equalizerBandHertzData } from './equalizerData';
import PlayerQueue from './playerQueue';

const AUDIO_FADE_DURATION = 250;

type PlayerEventType =
  | 'timeUpdate'
  | 'durationChange'
  | 'play'
  | 'pause'
  | 'error'
  | 'seeking'
  | 'seeked'
  | 'repeatOne'
  | 'repeatAll'
  | 'playbackComplete'
  | 'songLoaded'
  | 'loadError'
  | 'recordListening'
  | 'repeatSong'
  | 'repeatModeChange'
  | 'queueChange'
  | 'queueMetadataChange';

type PlayerEventCallback<T = unknown> = (data: T) => void;

/**
 * AudioPlayer class that manages audio playback with integrated queue management. Provides
 * event-based architecture for player state changes. Owns a PlayerQueue instance and automatically
 * reacts to queue position changes.
 */
class AudioPlayer {
  private listeners: Map<PlayerEventType, Set<PlayerEventCallback<unknown>>>;

  audio: HTMLAudioElement;
  queue: PlayerQueue;
  currentVolume: number;

  currentContext: AudioContext;
  equalizerBands: Map<EqualizerBandFilters, BiquadFilterNode>;
  gainNode: GainNode;

  unsubscribeFunc: Subscription;

  private repeatMode: 'off' | 'one' | 'all' = 'off';
  private pendingAutoPlay: boolean = false;

  constructor(queue: PlayerQueue) {
    this.listeners = new Map();

    this.audio = new Audio();
    this.queue = queue;

    this.audio.preload = 'auto';
    this.audio.defaultPlaybackRate = 1.0;

    this.currentContext = new window.AudioContext();
    this.equalizerBands = new Map();
    this.gainNode = this.currentContext.createGain();

    this.volume = this.audio.volume;
    this.currentVolume = this.audio.volume * 100;

    this.unsubscribeFunc = this.subscribeToStoreEvents();
    this.initializeEqualizer();
    this.setupQueueIntegration();
    this.setupAudioEventListeners();
  }

  /**
   * Sets up integration between queue and player. Automatically loads songs when queue position
   * changes. Propagates queue events through player for convenience.
   */
  private setupQueueIntegration() {
    this.queue.on('positionChange', (data) => {
      const songId = data?.currentSongId || this.queue.currentSongId;
      console.log('[AudioPlayer.positionChange]', {
        position: this.queue.position,
        songId,
        willLoad: !!songId,
        pendingAutoPlay: this.pendingAutoPlay
      });
      if (songId) {
        // If the song ID is the same as the current playing song, and we are not forcing a play,
        // we can avoid reloading the song to prevent audio interruption (e.g. during shuffle)
        const isSameSong = songId === store.state.currentSongData?.songId;
        if (!isSameSong || this.pendingAutoPlay) {
          this.loadSong(songId, { autoPlay: this.pendingAutoPlay }).catch((err) => {
            console.error('[AudioPlayer.positionChange] Failed to load song:', err);
            // Error will be handled by error event listener
          });
        }
        this.pendingAutoPlay = false; // Reset after use
      }
    });

    // Propagate queue change events through player
    this.queue.on('queueChange', (data) => {
      this.emit('queueChange', data);
    });

    // Propagate metadata changes
    this.queue.on('metadataChange', (data) => {
      this.emit('queueMetadataChange', data);
    });
  }

  /**
   * Sets up audio element event listeners. Emits player events for time updates, playback end,
   * errors, etc.
   */
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;

  private connectAudioToWebAudio() {
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch (e) {}
    }
    console.log('[AudioPlayer] Connecting HTMLAudioElement to Web Audio API graph.');
    this.mediaSourceNode = this.currentContext.createMediaElementSource(this.audio);
    const firstFilterKey = [...this.equalizerBands.keys()][0];
    const firstFilter = this.equalizerBands.get(firstFilterKey);
    if (firstFilter) {
      this.mediaSourceNode.connect(firstFilter);
    }
  }

  private handleEnded = () => {
    console.log('[AudioPlayer.audio] Song playback ended.');
    this.handleSongEnd();
  };

  private handleTimeUpdate = () => {
    this.emit('timeUpdate', this.audio.currentTime);
  };

  private handleLoadedMetadata = () => {
    console.log('[AudioPlayer.audio] Metadata loaded:', {
      duration: this.audio.duration,
      src: this.audio.src,
      crossOrigin: this.audio.crossOrigin
    });
    this.emit('durationChange', this.audio.duration);
  };

  private handlePlay = () => {
    console.log('[AudioPlayer.audio] Play event fired. Audio details:', {
      src: this.audio.src,
      crossOrigin: this.audio.crossOrigin,
      paused: this.audio.paused,
      currentTime: this.audio.currentTime,
      networkState: this.audio.networkState,
      readyState: this.audio.readyState
    });
    this.emit('play');
  };

  private handlePause = () => {
    console.log('[AudioPlayer.audio] Pause event fired.');
    this.emit('pause');
  };

  private handleError = (e: ErrorEvent) => {
    console.error('[AudioPlayer.audio] Error event fired. Details:', {
      error: this.audio.error,
      src: this.audio.src,
      crossOrigin: this.audio.crossOrigin
    });
    this.emit('error', e);
  };

  private handleSeeking = () => {
    this.emit('seeking');
  };

  private handleSeeked = () => {
    this.emit('seeked', this.audio.currentTime);
  };

  private setupAudioEventListeners() {
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.audio.addEventListener('play', this.handlePlay);
    this.audio.addEventListener('pause', this.handlePause);
    this.audio.addEventListener('error', this.handleError as any);
    this.audio.addEventListener('seeking', this.handleSeeking);
    this.audio.addEventListener('seeked', this.handleSeeked);
  }

  private removeAudioEventListeners() {
    if (!this.audio) return;
    this.audio.removeEventListener('ended', this.handleEnded);
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.audio.removeEventListener('play', this.handlePlay);
    this.audio.removeEventListener('pause', this.handlePause);
    this.audio.removeEventListener('error', this.handleError as any);
    this.audio.removeEventListener('seeking', this.handleSeeking);
    this.audio.removeEventListener('seeked', this.handleSeeked);
  }

  /**
   * Handles song end based on repeat mode. Automatically advances queue or repeats as configured.
   * Auto-resumes playback for the next song.
   */
  private async handleSongEnd() {
    console.log('[AudioPlayer.handleSongEnd]', { repeatMode: this.repeatMode });

    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      await this.play();
      this.emit('repeatOne');
      return;
    }

    if (this.queue.hasNext) {
      this.pendingAutoPlay = true;
      this.queue.moveToNext();
      // Song will be auto-loaded via positionChange event with autoPlay
    } else if (this.repeatMode === 'all' && this.queue.length > 0) {
      this.pendingAutoPlay = true;
      this.queue.moveToPosition(0);
      this.emit('repeatAll');
      // Song will be auto-loaded via positionChange event with autoPlay
    } else {
      this.emit('playbackComplete');
    }
  }

  /**
   * Loads a song into the audio element. Fetches song data from API if songId is provided, or uses
   * provided songData. Sets up audio source and dispatches events.
   *
   * @param songIdOrData - The ID of the song to load or the song data object
   * @param options - Optional configuration for song loading
   * @returns Promise resolving to the song data
   */
  private async loadSong(
    songIdOrData: number | AudioPlayerData,
    options?: { autoPlay?: boolean; updateStore?: boolean }
  ): Promise<AudioPlayerData> {
    let songData: AudioPlayerData;

    if (typeof songIdOrData === 'number') {
      // Fetch song data if ID provided
      songData = await window.api.audioLibraryControls.getSong(songIdOrData);
    } else {
      // Use provided song data
      songData = songIdOrData;
    }

    try {
      console.log('[AudioPlayer.loadSong] Loading song:', {
        songId: songData.songId,
        title: songData.title,
        isOnlineStream: songData.isOnlineStream,
        path: songData.isOnlineStream ? '[REDACTED]' : songData.path,
        options
      });

      // Update store with current song data if requested
      if (options?.updateStore !== false) {
        dispatch({ type: 'CURRENT_SONG_DATA_CHANGE', data: songData });

        // Update localStorage
        storage.playback.setCurrentSongOptions('songId', songData.songId);
      }

      // Configure active audio element based on online vs local stream
      const isOnline = !!songData.isOnlineStream;
      const currentlyConnected = !!this.mediaSourceNode;
      const needsConnection = !isOnline;

      if (!this.audio || currentlyConnected !== needsConnection) {
        console.log(`[AudioPlayer.loadSong] Recreating HTMLAudioElement. Needs Web Audio: ${needsConnection}`);
        
        if (this.audio) {
          this.audio.pause();
          this.audio.src = '';
          this.audio.load();
          this.removeAudioEventListeners();
        }

        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.defaultPlaybackRate = 1.0;
        this.audio.volume = needsConnection ? 1.0 : this.volume;
        this.audio.muted = store.state.localStorage.preferences?.volume?.isMuted || false;

        if (needsConnection) {
          this.connectAudioToWebAudio();
        } else {
          this.mediaSourceNode = null;
        }

        this.setupAudioEventListeners();
      }

      // Configure crossOrigin BEFORE setting src to allow Web Audio API/Equalizer access via CORS
      if (songData.isOnlineStream) {
        console.log('[AudioPlayer.loadSong] Online stream detected. Disabling crossOrigin CORS headers to prevent YouTube 403 blocks.');
        this.audio.removeAttribute('crossOrigin');
      } else {
        console.log('[AudioPlayer.loadSong] Setting crossOrigin = "anonymous" for media element.');
        this.audio.crossOrigin = 'anonymous';
      }

      // Set audio source — online streams already have unique URLs, local files get cache-busting
      if (songData.isOnlineStream) {
        this.audio.src = songData.path;
      } else {
        const cleanPath = songData.path.split('?')[0];
        this.audio.src = `${cleanPath}?ts=${Date.now()}`;
      }

      console.log('[AudioPlayer.loadSong] Audio source set to:', songData.isOnlineStream ? '[REDACTED]' : this.audio.src);

      // Load is synchronous, no need to await
      this.audio.load();

      // Set up auto-play if requested
      if (options?.autoPlay) {
        // Check if audio is already ready to play (cached/buffered)
        if (this.audio.readyState >= 3) {
          // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA - ready to play
          console.log('[AudioPlayer.loadSong] ReadyState is high, playing immediately.');
          this.play().catch((err) =>
            console.error('[AudioPlayer] Immediate auto-play failed:', err)
          );
        } else {
          // Wait for canplay event
          console.log('[AudioPlayer.loadSong] Waiting for "canplay" event to start playing.');
          const autoPlayHandler = () => {
            console.log('[AudioPlayer.loadSong.autoPlay] "canplay" event fired. Playing now.');
            this.play().catch((err) =>
              console.error('[AudioPlayer] Auto-play on canplay failed:', err)
            );
            this.audio.removeEventListener('canplay', autoPlayHandler);
          };
          this.audio.addEventListener('canplay', autoPlayHandler);
        }
      }

      // Dispatch custom track change event
      const trackChangeEvent = new CustomEvent('player/trackchange', {
        detail: songData.songId
      });
      this.audio.dispatchEvent(trackChangeEvent);

      this.emit('songLoaded', songData);
      console.log('[AudioPlayer.loadSong.done] Successfully loaded song:', {
        songId: songData.songId,
        title: songData.title,
        isOnlineStream: songData.isOnlineStream
      });

      return songData;
    } catch (error) {
      console.error(
        `Failed to load song (ID: ${songData.songId}):`,
        error instanceof Error ? error.message : error
      );
      this.emit('loadError', { songId: songData.songId, error });
      throw error; // Re-throw for caller to handle
    }
  }

  /** Cleans up resources and event listeners. Should be called when player is no longer needed. */
  destroy() {
    if (this.unsubscribeFunc) this.unsubscribeFunc.unsubscribe();
    this.queue.removeAllListeners();
    this.removeAllListeners();
    this.audio.pause();
    this.audio.src = '';
    this.currentContext.close();
  }

  /**
   * Subscribe to an event.
   *
   * @param eventType - The type of event to listen for
   * @param callback - Function to call when event is emitted
   */
  on<T = unknown>(eventType: PlayerEventType, callback: PlayerEventCallback<T>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)?.add(callback as PlayerEventCallback<unknown>);
  }

  /**
   * Remove an event listener.
   *
   * @param eventType - The type of event
   * @param callback - The callback to remove
   */
  off<T = unknown>(eventType: PlayerEventType, callback: PlayerEventCallback<T>): void {
    this.listeners.get(eventType)?.delete(callback as PlayerEventCallback<unknown>);
  }

  /**
   * Emit an event to all listeners.
   *
   * @param eventType - The type of event to emit
   * @param data - The data to pass to listeners
   */
  protected emit<T = unknown>(eventType: PlayerEventType, data?: T): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(data);
      });
    }
  }

  /** Remove all listeners for all events. */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  private fadeOutAudio(): Promise<void> {
    return new Promise((resolve) => {
      const currentTime = this.currentContext.currentTime;
      const targetVolume = 0.001; // Very low but not zero to avoid clicks
      const fadeDuration = AUDIO_FADE_DURATION / 1000; // Convert to seconds

      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, currentTime + fadeDuration);

      // Schedule pause after fade completes
      setTimeout(() => {
        this.audio.pause();
        resolve(undefined);
      }, AUDIO_FADE_DURATION);
    });
  }

  private fadeInAudio(): Promise<void> {
    return new Promise((resolve) => {
      const currentTime = this.currentContext.currentTime;
      const targetVolume = this.currentVolume / 100;
      const fadeDuration = AUDIO_FADE_DURATION / 1000; // Convert to seconds

      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, currentTime + fadeDuration);

      // Resolve after fade completes
      setTimeout(() => {
        resolve(undefined);
      }, AUDIO_FADE_DURATION);
    });
  }

  private initializeEqualizer() {
    console.log('[AudioPlayer.initializeEqualizer] Initializing Web Audio graph and equalizer.');
    for (const [filterName, hertzValue] of Object.entries(equalizerBandHertzData)) {
      const equalizerFilterName = filterName as EqualizerBandFilters;
      const equalizerBand = this.currentContext.createBiquadFilter();

      equalizerBand.type = 'peaking';
      equalizerBand.frequency.value = hertzValue;
      equalizerBand.Q.value = 1;
      equalizerBand.gain.value = 0;

      this.equalizerBands.set(equalizerFilterName, equalizerBand);
    }

    const filterMapKeys = [...this.equalizerBands.keys()];

    this.equalizerBands.forEach((filter, key, map) => {
      const currentFilterIndex = filterMapKeys.indexOf(key);
      const isTheFirstFilter = currentFilterIndex === 0;
      const isTheLastFilter = currentFilterIndex === filterMapKeys.length - 1;

      if (!isTheFirstFilter) {
        const prevFilter = map.get(filterMapKeys[currentFilterIndex - 1]);
        if (prevFilter) prevFilter.connect(filter);
      }
      if (isTheLastFilter) {
        filter.connect(this.gainNode);
      }
    });

    // Connect gain node to destination
    this.gainNode.connect(this.currentContext.destination);

    // Initial connection
    this.connectAudioToWebAudio();
  }

  // ? PLAYER RELATED STORE UPDATES HANDLING
  private updatePlayerVolume(volume: PlayerVolume) {
    this.volume = volume.value / 100;
    this.audio.muted = volume.isMuted;
  }

  private updatePlaybackRate(playbackRate: number) {
    if (this.audio.playbackRate !== playbackRate) {
      this.audio.playbackRate = playbackRate;
    }
  }

  private subscribeToStoreEvents() {
    const unsubscribeFunction = store.subscribe(() => {
      if (store) {
        const { player } = store.state;

        this.updatePlayerVolume(player.volume);
        this.updatePlaybackRate(player.playbackRate);
        this.syncRepeatModeFromStore(player.isRepeating);
      }
    });

    return unsubscribeFunction;
  }

  private syncRepeatModeFromStore(isRepeating: RepeatTypes) {
    // Convert store's RepeatTypes to AudioPlayer's repeat mode format
    const newMode = isRepeating === 'repeat-1' ? 'one' : isRepeating === 'repeat' ? 'all' : 'off';
    if (this.repeatMode !== newMode) {
      this.repeatMode = newMode;
    }
  }

  // ========== PUBLIC PLAYBACK CONTROLS ==========

  /** Starts or resumes audio playback with fade-in effect. */
  play() {
    console.log('[AudioPlayer.play] Initiating playback. Current state:', {
      src: this.audio.src,
      crossOrigin: this.audio.crossOrigin,
      paused: this.audio.paused,
      currentTime: this.audio.currentTime
    });
    this.audio.play();
    return this.fadeInAudio();
  }

  /** Pauses audio playback with fade-out effect. */
  pause() {
    console.log('[AudioPlayer.pause] Initiating pause.');
    return this.fadeOutAudio();
  }

  /**
   * Toggles playback between play and pause.
   *
   * @param forcePlay - If true, always play; if false, always pause; if undefined, toggle
   * @returns Promise that resolves when fade completes
   */
  async togglePlayback(forcePlay?: boolean): Promise<void> {
    const shouldPlay = forcePlay !== undefined ? forcePlay : this.audio.paused;

    if (shouldPlay) {
      if (this.audio.readyState > 0) {
        await this.play();
      }
    } else {
      await this.pause();
    }
  }

  /**
   * Seeks to a specific time position in the current song.
   *
   * @param time - Time in seconds to seek to
   */
  seek(time: number) {
    this.audio.currentTime = time;
  }

  /**
   * Loads and optionally plays a song by ID. This is the public API for loading songs - handles
   * store updates, localStorage, and analytics.
   *
   * @param songId - The ID of the song to load
   * @param options - Configuration options
   * @returns Promise that resolves when song is loaded and optionally playing
   */
  async playSongById(
    songId: number,
    options: {
      autoPlay?: boolean;
      recordListening?: boolean;
      onError?: (error: unknown) => void;
    } = {}
  ): Promise<void> {
    const { autoPlay = true, recordListening = true, onError } = options;

    try {
      console.log('[AudioPlayer.playSongById]', { songId, autoPlay });

      // Fetch song data once
      const songData = await window.api.audioLibraryControls.getSong(songId);

      // Load song with store updates
      await this.loadSong(songData, { autoPlay, updateStore: true });

      // Record listening data if requested
      if (recordListening) {
        // Note: Listening data recording will be handled by the hook until fully migrated
        this.emit('recordListening', { songId, duration: songData.duration });
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  // ========== QUEUE NAVIGATION ==========

  /**
   * Skips forward to the next song in the queue. Handles repeat modes and automatically loads/plays
   * the next song.
   *
   * @param reason - Why the skip occurred ('USER_SKIP' or 'PLAYER_SKIP')
   */
  async skipForward(reason: SongSkipReason = 'USER_SKIP'): Promise<void> {
    console.log('[AudioPlayer.skipForward]', {
      reason,
      position: this.queue.position,
      hasNext: this.queue.hasNext,
      repeatMode: this.repeatMode
    });

    // Handle repeat-one mode (only auto-repeat, not on user skip)
    if (this.repeatMode === 'one' && reason !== 'USER_SKIP') {
      this.audio.currentTime = 0;
      await this.play();

      // Emit event for listening data recording (repetition)
      if (store.state.currentSongData?.songId) {
        this.emit('repeatSong', {
          songId: store.state.currentSongData.songId,
          duration: store.state.currentSongData.duration
        });
      }
      return;
    }

    // Move to next song or restart queue if repeat-all
    if (this.queue.hasNext) {
      this.pendingAutoPlay = true; // Auto-play next song on manual skip
      this.queue.moveToNext();
      console.log('[AudioPlayer.skipForward.moved]', {
        position: this.queue.position
      });
    } else if (this.repeatMode === 'all' && this.queue.length > 0) {
      this.pendingAutoPlay = true; // Auto-play when restarting queue
      this.queue.moveToStart();
    } else if (this.queue.isEmpty) {
      console.log('[AudioPlayer.skipForward] Queue is empty.');
    }
    // else: at end without repeat, do nothing (song ends)
  }

  /**
   * Skips backward to the previous song or restarts current song. If current time > 5 seconds,
   * restarts current song. Otherwise, moves to previous song in queue.
   */
  skipBackward(): void {
    console.log('[AudioPlayer.skipBackward]', {
      currentTime: this.audio.currentTime,
      position: this.queue.position,
      hasPrevious: this.queue.hasPrevious
    });

    // If more than 5 seconds into song, restart it
    if (this.audio.currentTime > 5) {
      this.audio.currentTime = 0;
      return;
    }

    // Move to previous song if available
    if (this.queue.currentSongId !== null) {
      if (this.queue.hasPrevious) {
        this.pendingAutoPlay = true; // Auto-play previous song on manual skip
        this.queue.moveToPrevious();
      } else {
        // At first song, restart it
        this.pendingAutoPlay = true;
        this.queue.moveToStart();
      }
    } else if (this.queue.length > 0) {
      // No current song but queue has songs, play first
      this.pendingAutoPlay = true;
      this.queue.moveToStart();
    }
  }

  /**
   * Plays the next song in the queue. Delegates to queue's moveToNext() which triggers song
   * loading.
   *
   * @deprecated Use skipForward() instead for better control
   */
  playNext() {
    if (this.queue.hasNext) {
      this.queue.moveToNext();
    }
  }

  /**
   * Plays the previous song in the queue. Delegates to queue's moveToPrevious() which triggers song
   * loading.
   *
   * @deprecated Use skipBackward() instead for better control
   */
  playPrevious() {
    if (this.queue.hasPrevious) {
      this.queue.moveToPrevious();
    }
  }

  /**
   * Plays a song at a specific position in the queue.
   *
   * @param position - The queue position (0-indexed)
   */
  playSongAtPosition(position: number) {
    this.pendingAutoPlay = true; // Auto-play when manually selecting a position
    const moved = this.queue.moveToPosition(position);
    if (!moved) {
      console.error('[AudioPlayer.playSongAtPosition] Failed to move to position:', position);
    }
    // Song will be auto-loaded via queue's positionChange event
  }

  /**
   * Plays an online song by directly loading its AudioPlayerData (which contains a stream URL
   * as `path`). Bypasses the queue system since online songs are not part of the local library.
   *
   * @param songData - The AudioPlayerData with isOnlineStream=true and a stream URL path
   */
  async playOnlineSong(songData: AudioPlayerData): Promise<void> {
    console.log('[AudioPlayer.playOnlineSong] Playing online song:', {
      title: songData.title,
      videoId: songData.onlineVideoId,
      path: '[REDACTED]'
    });
    await this.loadSong(songData, { autoPlay: true, updateStore: true });
  }

  // ========== REPEAT MODE MANAGEMENT ==========

  /**
   * Sets the repeat mode.
   *
   * @param mode - 'off' | 'one' | 'all'
   */
  setRepeatMode(mode: 'off' | 'one' | 'all') {
    this.repeatMode = mode;
    this.emit('repeatModeChange', mode);
  }

  /** Gets the current repeat mode. */
  getRepeatMode(): 'off' | 'one' | 'all' {
    return this.repeatMode;
  }

  // ========== GETTERS FOR CURRENT STATE ==========

  /** Gets the current song ID from the queue. */
  get currentSongId(): number | null {
    return this.queue.currentSongId;
  }

  /** Gets the current playback time in seconds. */
  get currentTime(): number {
    return this.audio.currentTime;
  }

  /** Sets the current playback time in seconds. */
  set currentTime(time: number) {
    this.audio.currentTime = time;
  }

  /** Gets the duration of the current song in seconds. */
  get duration(): number {
    return this.audio.duration;
  }

  /** Gets whether the audio is currently paused. */
  get paused(): boolean {
    return this.audio.paused;
  }

  /** Gets the current volume (0-1). */
  get volume(): number {
    return this.currentVolume / 100;
  }

  /** Sets the volume (0-1). */
  set volume(volume: number) {
    this.currentVolume = volume * 100;
    // For online streams (no Web Audio connection), use audio.volume directly.
    // For local songs (Web Audio connected), set audio.volume to 1.0 and use gainNode for volume.
    if (this.mediaSourceNode) {
      this.audio.volume = 1.0;
      this.gainNode.gain.value = volume;
    } else {
      this.audio.volume = volume;
    }
  }

  /** Gets the muted state. */
  get muted(): boolean {
    return this.audio.muted;
  }

  /** Sets the muted state. */
  set muted(value: boolean) {
    this.audio.muted = value;
    if (this.mediaSourceNode) {
      this.gainNode.gain.value = value ? 0 : this.volume;
    }
  }

  /** Gets the current playback rate. */
  get playbackRate(): number {
    return this.audio.playbackRate;
  }

  /** Sets the playback rate. */
  set playbackRate(value: number) {
    this.audio.playbackRate = value;
  }
}

export default AudioPlayer;
