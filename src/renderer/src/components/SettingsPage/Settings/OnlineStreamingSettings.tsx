import { useState, useEffect } from 'react';
import Button from '../../Button';

const OnlineStreamingSettings = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState<{ url: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.onlineMusic.isYouTubeLoggedIn().then(setIsLoggedIn).catch(console.error);

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

  return (
    <li className="settings-section mb-6">
      <h2 className="settings-section-title mb-2 text-xl font-semibold">Online Streaming (YouTube Music)</h2>
      <div className="settings-section-content pl-4">
        <p className="mb-4 text-sm text-font-color-black/70 dark:text-font-color-white/70">
          Sign in to your YouTube Music account. This helps resolve streaming errors (Option 3).
          By default, SyncTax Desktop uses yt-dlp (Option 1) to stream online music.
        </p>

        {isLoggedIn ? (
          <div className="flex items-center text-green-500">
            <span className="material-icons-round mr-2 text-2xl">check_circle</span>
            <span>You are logged in to YouTube Music.</span>
          </div>
        ) : (
          <div>
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
      </div>
    </li>
  );
};

export default OnlineStreamingSettings;
