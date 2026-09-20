import { useState, useEffect } from 'react';
import Button from '../../Button';

const OnlineStreamingSettings = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState<{ url: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // yt-dlp state
  const [isYtDlpInstalled, setIsYtDlpInstalled] = useState<boolean | null>(null);
  const [localVersion, setLocalVersion] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const checkInstallation = async () => {
    try {
      const installed = await window.api.onlineMusic.isYtDlpInstalled();
      setIsYtDlpInstalled(installed);
      if (installed) {
        const updateInfo = await window.api.onlineMusic.checkYtDlpUpdate();
        if (updateInfo.localVersion) setLocalVersion(updateInfo.localVersion);
        if (updateInfo.latestVersion) setLatestVersion(updateInfo.latestVersion);
        setUpdateAvailable(!!updateInfo.updateAvailable);
      }
    } catch (e) {
      console.error('Failed to check yt-dlp installation:', e);
    }
  };

  useEffect(() => {
    window.api.onlineMusic.isYouTubeLoggedIn().then(setIsLoggedIn).catch(console.error);
    checkInstallation();

    const unsubscribe = window.api.onlineMusic.onYouTubeLoginPending((_, data) => {
      setLoginPrompt({ url: data.verification_url, code: data.user_code });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleLogin = async () => {
    setError(null);
    try {
      await window.api.onlineMusic.loginToYouTube();
      setIsLoggedIn(true);
      setLoginPrompt(null);
    } catch (err: any) {
      setError(err.message || 'Login failed');
      setLoginPrompt(null);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const updateInfo = await window.api.onlineMusic.checkYtDlpUpdate();
      if (updateInfo.error) {
        setUpdateError(updateInfo.error);
      } else {
        if (updateInfo.localVersion) setLocalVersion(updateInfo.localVersion);
        if (updateInfo.latestVersion) setLatestVersion(updateInfo.latestVersion);
        setUpdateAvailable(!!updateInfo.updateAvailable);
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Failed to check for updates');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleUpdateYtDlp = async () => {
    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateError(null);

    const handleProgress = (_event: unknown, progress: number) => {
      setUpdateProgress(progress);
    };

    const unsubscribe = window.api.onlineMusic.onYtDlpDownloadProgress(handleProgress);

    try {
      await window.api.onlineMusic.downloadYtDlp();
      setIsYtDlpInstalled(true);
      setUpdateAvailable(false);
      await checkInstallation();
    } catch (err: any) {
      console.error('Failed to update/download yt-dlp:', err);
      setUpdateError(err.message || 'Failed to update yt-dlp');
    } finally {
      setIsUpdating(false);
      unsubscribe();
    }
  };

  return (
    <li className="settings-section mb-6">
      <h2 className="settings-section-title mb-2 text-xl font-semibold">Online Streaming (YouTube Music)</h2>
      <div className="settings-section-content pl-4">
        <p className="mb-4 text-sm text-font-color-black/70 dark:text-font-color-white/70">
          Sign in to your YouTube Music account. This helps resolve streaming errors (Option 3).
          By default, SyncTax Desktop uses yt-dlp (Option 1) to stream online music.
        </p>

        {isLoggedIn ? (
          <div className="flex items-center text-green-500 mb-4">
            <span className="material-icons-round mr-2 text-2xl">check_circle</span>
            <span>You are logged in to YouTube Music.</span>
          </div>
        ) : (
          <div className="mb-4">
            {!loginPrompt ? (
              <Button clickHandler={handleLogin} label="Log in to YouTube Music" className="!w-fit px-4 py-2" />
            ) : (
              <div className="rounded-md border p-4 shadow-sm dark:border-zinc-700">
                <p className="mb-2 font-medium">Please authenticate in your browser:</p>
                <ol className="list-inside list-decimal space-y-1">
                  <li>
                    Go to:{' '}
                    <a
                      href={loginPrompt.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 underline"
                      onClick={(e) => {
                        e.preventDefault();
                        window.api.settingsHelpers.openInBrowser(loginPrompt.url);
                      }}
                    >
                      {loginPrompt.url}
                    </a>
                  </li>
                  <li>
                    Enter this code: <strong className="select-all bg-gray-200 p-1 dark:bg-zinc-800">{loginPrompt.code}</strong>
                  </li>
                </ol>
                <p className="mt-2 text-xs opacity-70">Waiting for authentication...</p>
              </div>
            )}
            {error && <p className="mt-2 text-red-500">{error}</p>}
          </div>
        )}

        <hr className="my-6 border-zinc-200 dark:border-zinc-850" />

        <div className="mt-4">
          <h3 className="mb-2 text-md font-medium text-font-color-black dark:text-font-color-white">
            yt-dlp Component Status
          </h3>
          {isYtDlpInstalled === null ? (
            <p className="text-xs opacity-75">Checking yt-dlp installation...</p>
          ) : isYtDlpInstalled === false ? (
            <div>
              <p className="mb-4 text-sm text-red-550 flex items-center">
                <span className="material-icons-round mr-2 text-xl">error_outline</span>
                <span>yt-dlp is not installed. You will not be able to stream online music.</span>
              </p>
              {isUpdating ? (
                <div className="mb-4">
                  <p className="text-sm mb-1">Downloading yt-dlp: {updateProgress}%</p>
                  <div className="h-2 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-md overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-100 ease-out"
                      style={{ width: `${updateProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <Button
                  clickHandler={handleUpdateYtDlp}
                  label="Download & Install yt-dlp"
                  className="!w-fit px-4 py-2"
                  iconName="download"
                />
              )}
            </div>
          ) : (
            <div>
              <div className="mb-4 space-y-2">
                <p className="text-sm flex items-center text-green-600 dark:text-green-400">
                  <span className="material-icons-round mr-2 text-xl">check_circle_outline</span>
                  <span>yt-dlp is installed.</span>
                </p>
                <div className="text-xs space-y-1 opacity-80 pl-7">
                  {localVersion && (
                    <p>
                      <strong>Local version:</strong> {localVersion}
                    </p>
                  )}
                  {latestVersion && (
                    <p>
                      <strong>Latest version:</strong> {latestVersion}
                    </p>
                  )}
                </div>
              </div>

              {updateAvailable && (
                <div className="mb-4 border border-blue-200 dark:border-blue-800 bg-blue-50/20 dark:bg-blue-900/10 p-3 rounded-lg max-w-md">
                  <p className="text-sm text-blue-600 dark:text-blue-400 mb-2 flex items-center font-medium">
                    <span className="material-icons-round mr-2 text-xl">info</span>
                    <span>An update is available for yt-dlp! ({latestVersion})</span>
                  </p>
                  {isUpdating ? (
                    <div>
                      <p className="text-xs mb-1">Updating: {updateProgress}%</p>
                      <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-md overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-100 ease-out"
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <Button
                      clickHandler={handleUpdateYtDlp}
                      label="Update yt-dlp Now"
                      className="!w-fit px-3 py-1.5 text-xs"
                      iconName="update"
                    />
                  )}
                </div>
              )}

              {!updateAvailable && !isUpdating && (
                <div className="flex items-center space-x-2">
                  <Button
                    clickHandler={handleCheckUpdate}
                    label={isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
                    isDisabled={isCheckingUpdate}
                    className="!w-fit px-4 py-2"
                    iconName="sync"
                  />
                  {!isCheckingUpdate && latestVersion && (
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center font-medium">
                      <span className="material-icons-round mr-1 text-sm">done</span>
                      Up to date
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {updateError && (
            <p className="mt-2 text-sm text-red-500 flex items-center">
              <span className="material-icons-round mr-1 text-sm">error</span>
              {updateError}
            </p>
          )}
        </div>
      </div>
    </li>
  );
};

export default OnlineStreamingSettings;

