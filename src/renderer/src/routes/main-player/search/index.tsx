import Button from '@renderer/components/Button';
import MainContainer from '@renderer/components/MainContainer';
import NoSearchResultsContainer from '@renderer/components/SearchPage/NoSearchResultsContainer';
import AlbumSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/AlbumSearchResultsContainer';
import ArtistsSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/ArtistsSearchResultsContainer';
import GenreSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/GenreSearchResultsContainer';
import MostRelevantSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/MostRelevantSearchResultsContainer';
import OnlineSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/OnlineSearchResultsContainer';
import PlaylistSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/PlaylistSearchResultsContainer';
import SongSearchResultsContainer from '@renderer/components/SearchPage/Result_Containers/SongSearchResultsContainer';
import { searchFilter } from '@renderer/components/SearchPage/SearchOptions';
import SearchResultsFilter from '@renderer/components/SearchPage/SearchResultsFilter';
import SearchStartPlaceholder from '@renderer/components/SearchPage/SearchStartPlaceholder';
import useResizeObserver from '@renderer/hooks/useResizeObserver';
import { onlineMusicQuery } from '@renderer/queries/onlineMusic';
import { searchQuery } from '@renderer/queries/search';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { searchPageSchema } from '@renderer/utils/zod/searchPageSchema';
import { useThrottledCallback } from '@tanstack/react-pacer';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/search/')({
  validateSearch: searchPageSchema,
  component: SearchPage
  // loaderDeps: ({ search }) => ({ search }),
  // loader: ({ deps }) => {
  //   const { search } = deps;

  // if ((search.keyword ?? '').trim().length === 0) return;
  // return queryClient.ensureQueryData(
  //   searchQuery.query({
  //     keyword: search.keyword ?? '',
  //     filter: search.filterBy ?? 'all',
  //     isSimilaritySearchEnabled: search.isSimilaritySearchEnabled ?? false,
  //     updateSearchHistory: true
  //   })
  // );
  // }
});

const ARTIST_WIDTH = 175;
const ALBUM_WIDTH = 210;
const PLAYLIST_WIDTH = 160;
const GENRE_WIDTH = 300;

function SearchPage() {
  const isSimilaritySearchEnabledInLocalStorage = useStore(
    store,
    (state) => state.localStorage.preferences.isSimilaritySearchEnabled
  );

  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    keyword,
    isSimilaritySearchEnabled = isSimilaritySearchEnabledInLocalStorage,
    filterBy
  } = Route.useSearch();

  const searchContainerRef = useRef(null);
  const { width } = useResizeObserver(searchContainerRef);
  const [searchText, setSearchText] = useState(keyword);
  const [isOnlineSearch, setIsOnlineSearch] = useState(false);
  const [isYtDlpInstalled, setIsYtDlpInstalled] = useState<boolean | 'checking'>('checking');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // LOG: when user visits the search screen
  useEffect(() => {
    window.api.log.sendLogs('User visited the Search screen', { isOnlineSearch });
  }, []);

  // LOG: when user shifts to online song mode
  useEffect(() => {
    window.api.log.sendLogs('User toggled search mode', { isOnlineSearch });
    if (isOnlineSearch) {
      window.api.onlineMusic.isYtDlpInstalled()
        .then((installed) => {
          setIsYtDlpInstalled(installed);
          window.api.log.sendLogs('Checked yt-dlp installation status', { installed });
        })
        .catch((err) => {
          console.error('Failed to check yt-dlp installation', err);
          setIsYtDlpInstalled(false);
          window.api.log.sendLogs('Failed to check yt-dlp installation', { error: String(err) });
        });
    }
  }, [isOnlineSearch]);

  const startYtDlpDownload = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    window.api.log.sendLogs('User initiated yt-dlp download');

    const handleProgress = (_event: unknown, progress: number) => {
      setDownloadProgress(progress);
    };

    const unsubscribe = window.api.onlineMusic.onYtDlpDownloadProgress(handleProgress);

    try {
      await window.api.onlineMusic.downloadYtDlp();
      setIsYtDlpInstalled(true);
      window.api.log.sendLogs('yt-dlp download completed successfully');
    } catch (error) {
      console.error('Failed to download yt-dlp', error);
      window.api.log.sendLogs('Failed to download yt-dlp', { error: String(error) });
    } finally {
      setIsDownloading(false);
      unsubscribe();
    }
  };

  // Local library search query
  const { data: searchResults } = useQuery({
    ...searchQuery.query({
      keyword: keyword ?? '',
      filter: filterBy ?? 'all',
      isSimilaritySearchEnabled
    }),
    enabled: (keyword ?? '').trim().length > 0 && !isOnlineSearch
  });

  // Online search query (YouTube Music)
  const { data: onlineResults, isFetching: isOnlineSearching } = useQuery({
    ...onlineMusicQuery.search({ query: keyword ?? '' }),
    enabled: (keyword ?? '').trim().length > 0 && isOnlineSearch && isYtDlpInstalled === true
  });

  const throttledSetSearch = useThrottledCallback(
    (value) => {
      navigate({ search: (prev) => ({ ...prev, keyword: value }), replace: true });
    },
    {
      wait: 1000
    }
  );

  const updateSearchInput = (input: string) => {
    const value = input ?? '';
    setSearchText(value);

    throttledSetSearch(value);
  };

  const { noOfArtists, noOfPlaylists, noOfAlbums, noOfGenres } = useMemo(() => {
    return {
      noOfPlaylists: Math.floor(width / PLAYLIST_WIDTH) || 4,
      noOfArtists: Math.floor(width / ARTIST_WIDTH) || 5,
      noOfAlbums: Math.floor(width / ALBUM_WIDTH) || 4,
      noOfGenres: Math.floor(width / GENRE_WIDTH) || 3
    };
  }, [width]);

  const filters = useMemo(
    () =>
      searchFilter.map((filter) => {
        return (
          <SearchResultsFilter
            key={filter.value}
            label={filter.label}
            icon={filter.icon}
            value={filter.value}
            isCurrentActiveFilter={filter.value === filterBy}
            changeActiveFilter={(filterType) =>
              navigate({ search: (prev) => ({ ...prev, filterBy: filterType }) })
            }
          />
        );
      }),
    [filterBy, navigate]
  );

  return (
    <MainContainer className="h-full! pb-0! [scrollbar-gutter:stable]" ref={searchContainerRef}>
      <div className="search-controls-container">
        <div className="search-input-container appear-from-bottom mb-4 flex items-center">
          <div className="search-bar-container bg-background-color-2 dark:bg-dark-background-color-2 flex w-1/2 max-w-xl min-w-[25rem] items-center rounded-3xl px-2 py-1">
            <Button
              className={`my-1! mr-2! ml-1! rounded-3xl! border-none px-4! py-2! shadow-sm outline-offset-1 focus-visible:outline! ${
                isSimilaritySearchEnabled
                  ? 'bg-background-color-3 dark:bg-dark-background-color-3 text-font-color-highlight-2! dark:text-dark-font-color-highlight-2!'
                  : 'bg-background-color-1/50 text-font-color-highlight! hover:bg-background-color-1 focus-visible:bg-background-color-1 dark:bg-dark-background-color-1/50 dark:text-dark-font-color-highlight! dark:hover:bg-dark-background-color-1 dark:focus-visible:bg-dark-background-color-1'
              }`}
              iconName={isSimilaritySearchEnabled ? 'auto_fix' : 'auto_fix_off'}
              tooltipLabel={t(
                `searchPage.${
                  isSimilaritySearchEnabled ? 'disablePredictiveSearch' : 'enablePredictiveSearch'
                }`
              )}
              iconClassName="material-icons-round-outlined"
              clickHandler={() => {
                storage.preferences.setPreferences(
                  'isSimilaritySearchEnabled',
                  !isSimilaritySearchEnabled
                );
                navigate({
                  search: (prev) => ({
                    ...prev,
                    isSimilaritySearchEnabled: !isSimilaritySearchEnabled
                  })
                });
              }}
            />
            {/* SEARCH INPUT */}
            <input
              type="search"
              name="search"
              id="searchBar"
              className="text-font-color-black placeholder:text-font-color-highlight dark:text-font-color-white dark:placeholder:text-dark-font-color-highlight h-full w-full border-2 border-[transparent] bg-[transparent] outline-hidden"
              aria-label="Search"
              placeholder={
                isOnlineSearch
                  ? t('searchPage.searchOnline', 'Search YouTube Music...')
                  : t('searchPage.searchForAnything')
              }
              value={searchText}
              onChange={(e) => updateSearchInput(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          {/* ONLINE / LIBRARY TOGGLE */}
          <Button
            className={`ml-3! rounded-3xl! border-none px-4! py-2! shadow-sm outline-offset-1 focus-visible:outline! ${
              isOnlineSearch
                ? 'bg-background-color-3 dark:bg-dark-background-color-3 text-font-color-highlight-2! dark:text-dark-font-color-highlight-2!'
                : 'bg-background-color-1/50 text-font-color-highlight! hover:bg-background-color-1 focus-visible:bg-background-color-1 dark:bg-dark-background-color-1/50 dark:text-dark-font-color-highlight! dark:hover:bg-dark-background-color-1 dark:focus-visible:bg-dark-background-color-1'
            }`}
            iconName={isOnlineSearch ? 'language' : 'library_music'}
            label={isOnlineSearch ? t('searchPage.online', 'Online') : t('searchPage.library', 'Library')}
            tooltipLabel={
              isOnlineSearch
                ? t('searchPage.switchToLibrary', 'Switch to library search')
                : t('searchPage.switchToOnline', 'Switch to online search')
            }
            iconClassName="material-icons-round-outlined"
            clickHandler={() => setIsOnlineSearch((prev) => !prev)}
          />

          <span
            className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight ml-4 cursor-help text-2xl"
            title={t('searchPage.separateKeywords')}
          >
            help
          </span>
        </div>
        {/* SEARCH FILTERS — only show for library search */}
        {!isOnlineSearch && (
          <div className="search-filters-container mb-6">
            <ul className="flex items-center">{filters}</ul>
          </div>
        )}
        {/* Online search indicator */}
        {isOnlineSearch && (
          <div className="search-filters-container mb-6">
            <div className="text-font-color-highlight dark:text-dark-font-color-highlight flex items-center gap-2 text-sm">
              <span className="material-icons-round-outlined text-lg">language</span>
              {t('searchPage.onlineSearchDescription', 'Searching YouTube Music for songs to stream')}
              {isOnlineSearching && (
                <span className="material-icons-round animate-spin text-lg">hourglass_top</span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="search-results-container relative h-full!">
        {/* ONLINE RESULTS */}
        {isOnlineSearch && isYtDlpInstalled === true && onlineResults && (
          <OnlineSearchResultsContainer results={onlineResults} />
        )}

        {/* YT-DLP REQUIREMENT SUGGESTION */}
        {isOnlineSearch && isYtDlpInstalled === false && (
          <div className="flex h-[60%] flex-col items-center justify-center text-center p-8">
            <div className="bg-background-color-2/65 dark:bg-dark-background-color-2/65 border border-background-color-3/20 dark:border-dark-background-color-3/20 max-w-md rounded-2xl p-8 shadow-xl backdrop-blur-md">
              <span className="material-icons-round text-5xl text-background-color-3 dark:text-dark-background-color-3 mb-4 animate-pulse">
                download_for_offline
              </span>
              <h2 className="text-xl font-bold text-font-color-black dark:text-font-color-white mb-2">
                {t('searchPage.ytDlpRequiredTitle', 'Online Streaming Setup')}
              </h2>
              <p className="text-sm text-font-color-highlight dark:text-dark-font-color-highlight mb-6 leading-relaxed">
                {t(
                  'searchPage.ytDlpRequiredDesc',
                  'Nora uses yt-dlp to stream audio online. Download the required component to start listening to online music.'
                )}
              </p>
              <Button
                className="w-full! justify-center! bg-background-color-3 dark:bg-dark-background-color-3 text-font-color-highlight-2! dark:text-dark-font-color-highlight-2! font-semibold! py-3! rounded-xl! border-none!"
                label={t('searchPage.downloadYtDlp', 'Download required components')}
                clickHandler={startYtDlpDownload}
              />
            </div>
          </div>
        )}

        {/* LIBRARY RESULTS */}
        {!isOnlineSearch && searchResults && (
          <>
            {/* MOST RELEVANT SEARCH RESULTS */}
            <MostRelevantSearchResultsContainer searchResults={searchResults} />
            {/* SONG SEARCH RESULTS */}
            <SongSearchResultsContainer
              songs={searchResults.songs}
              searchInput={keyword}
              isSimilaritySearchEnabled={isSimilaritySearchEnabled}
            />
            {/* ARTIST SEARCH RESULTS */}
            <ArtistsSearchResultsContainer
              artists={searchResults.artists}
              searchInput={keyword}
              noOfVisibleArtists={noOfArtists}
              isSimilaritySearchEnabled={isSimilaritySearchEnabled}
            />
            {/* ALBUM SEARCH RESULTS */}
            <AlbumSearchResultsContainer
              albums={searchResults.albums}
              searchInput={keyword}
              noOfVisibleAlbums={noOfAlbums}
              isSimilaritySearchEnabled={isSimilaritySearchEnabled}
            />
            {/* PLAYLIST SEARCH RESULTS */}
            <PlaylistSearchResultsContainer
              playlists={searchResults.playlists}
              searchInput={keyword}
              noOfVisiblePlaylists={noOfPlaylists}
              isSimilaritySearchEnabled={isSimilaritySearchEnabled}
            />
            {/* GENRE SEARCH RESULTS */}
            <GenreSearchResultsContainer
              genres={searchResults.genres}
              searchInput={keyword}
              noOfVisibleGenres={noOfGenres}
              isSimilaritySearchEnabled={isSimilaritySearchEnabled}
            />
            {/* NO SEARCH RESULTS PLACEHOLDER */}
            <NoSearchResultsContainer
              searchInput={keyword}
              searchResults={searchResults}
              updateSearchInput={updateSearchInput}
            />
          </>
        )}
        {/* SEARCH START PLACEHOLDER */}
        {(!isOnlineSearch || isYtDlpInstalled !== false) && (
          <SearchStartPlaceholder
            searchResults={isOnlineSearch ? undefined : searchResults}
            searchInput={keyword}
            updateSearchInput={updateSearchInput}
          />
        )}
      </div>

      {/* DOWNLOAD PROGRESS OVERLAY */}
      {isDownloading && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-md transition-all duration-300">
          <div className="bg-background-color-1/90 dark:bg-dark-background-color-1/90 border border-background-color-3/15 dark:border-dark-background-color-3/15 max-w-sm w-full mx-4 p-8 rounded-2xl shadow-2xl flex flex-col items-center text-center backdrop-blur-lg animate-scale-up">
            <span className="material-icons-round text-5xl text-background-color-3 dark:text-dark-background-color-3 mb-4 animate-bounce">
              cloud_download
            </span>
            <h3 className="text-lg font-bold text-font-color-black dark:text-font-color-white mb-1">
              {t('searchPage.downloadingYtDlp', 'Downloading yt-dlp...')}
            </h3>
            <p className="text-xs text-font-color-highlight dark:text-dark-font-color-highlight mb-6">
              {t('searchPage.downloadingDesc', 'Setting up dependencies. Please do not close Nora.')}
            </p>
            
            {/* Progress Bar */}
            <div className="w-full bg-background-color-2 dark:bg-dark-background-color-2 h-3 rounded-full overflow-hidden mb-3 relative">
              <div 
                className="bg-background-color-3 dark:bg-dark-background-color-3 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            
            <span className="text-sm font-bold text-background-color-3 dark:text-dark-background-color-3">
              {downloadProgress}%
            </span>
          </div>
        </div>
      )}
    </MainContainer>
  );
}
