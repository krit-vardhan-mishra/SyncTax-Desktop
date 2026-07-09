import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlaylistDefaultCover from '../../assets/images/webp/playlist_cover_default.webp';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import Img from '../Img';

interface ImportOnlinePlaylistPromptProp {
  updatePlaylists: () => void;
}

const ImportOnlinePlaylistPrompt = (props: ImportOnlinePlaylistPromptProp) => {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [url, setUrl] = useState('');
  const [playlistType, setPlaylistType] = useState<'youtube' | 'spotify'>('youtube');
  const [customName, setCustomName] = useState('');
  const [isPending, setIsPending] = useState(false);

  const importPlaylist = () => {
    if (!url.trim()) {
      addNewNotifications([
        {
          id: 'EmptyPlaylistUrl',
          duration: 5000,
          content: 'Playlist URL cannot be empty'
        }
      ]);
      return;
    }

    setIsPending(true);
    window.api.playlistsData
      .importOnlinePlaylist(url.trim(), playlistType, customName.trim() || undefined)
      .then((res) => {
        setIsPending(false);
        if (res && res.success) {
          changePromptMenuData(false);
          props.updatePlaylists();
          addNewNotifications([
            {
              id: 'playlistImported',
              duration: 5000,
              content: `Successfully imported online playlist '${res.playlistName}' with ${res.count} songs!`
            }
          ]);
        } else {
          addNewNotifications([
            {
              id: 'playlistImportFailed',
              duration: 5000,
              content: 'Failed to import online playlist. Please verify the URL and ensure it is public.'
            }
          ]);
        }
      })
      .catch((err) => {
        setIsPending(false);
        addNewNotifications([
          {
            id: 'playlistImportFailed',
            duration: 5000,
            content: `Error: ${err.message || err}`
          }
        ]);
      });
  };

  return (
    <div className="flex flex-col items-center justify-center max-w-[500px] w-full p-4">
      <div className="img-container relative mb-6 max-w-[40%] rounded-xl">
        <Img
          src={PlaylistDefaultCover}
          alt="Playlist default cover"
          loading="eager"
          className="aspect-square w-full max-w-[12rem] rounded-xl shadow-lg brightness-90"
        />
      </div>
      <span className="mb-6 text-center text-2xl font-medium">
        Import Online Playlist
      </span>
      
      <div className="w-full flex flex-col gap-4">
        {/* Playlist Type Dropdown */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold opacity-70">Source Platform</label>
          <select
            value={playlistType}
            onChange={(e) => setPlaylistType(e.target.value as 'youtube' | 'spotify')}
            className="bg-background-color-2! text-font-color-black dark:bg-dark-background-color-2! dark:text-font-color-white w-full rounded-2xl border-[transparent] px-6 py-3 text-lg outline-hidden"
          >
            <option value="youtube">YouTube / YouTube Music</option>
            <option value="spotify">Spotify</option>
          </select>
        </div>

        {/* Playlist URL Input */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold opacity-70">Playlist Link (Public)</label>
          <input
            type="text"
            className="bg-background-color-2! text-font-color-black dark:bg-dark-background-color-2! dark:text-font-color-white w-full rounded-2xl border-[transparent] px-6 py-3 text-lg outline-hidden"
            placeholder={playlistType === 'youtube' ? 'https://music.youtube.com/playlist?list=...' : 'https://open.spotify.com/playlist/...'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isPending}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') importPlaylist();
            }}
          />
        </div>

        {/* Custom Playlist Name (Optional) */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold opacity-70">Custom Name (Optional)</label>
          <input
            type="text"
            className="bg-background-color-2! text-font-color-black dark:bg-dark-background-color-2! dark:text-font-color-white w-full rounded-2xl border-[transparent] px-6 py-3 text-lg outline-hidden"
            placeholder="My Cool Playlist"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            disabled={isPending}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') importPlaylist();
            }}
          />
        </div>
      </div>

      <Button
        label={isPending ? 'Importing...' : 'Import Playlist'}
        iconName="publish"
        className="bg-background-color-3! text-font-color-black! dark:bg-dark-background-color-3! dark:text-font-color-black mt-8 w-full justify-center p-2 py-3! text-lg cursor-pointer"
        clickHandler={importPlaylist}
        isDisabled={isPending}
      />
    </div>
  );
};

export default ImportOnlinePlaylistPrompt;
