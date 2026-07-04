import { useStore } from '@tanstack/react-store';
import { memo } from 'react';

import LightModeLogo from '../../assets/images/webp/logo_light_mode.webp';
import { store } from '../../store/store';
import Img from '../Img';
import CurrentLocationContainer from './CurrentLocationContainer';
import NetworkIndicator from './indicators/NetworkIndicator';
import NewUpdateIndicator from './indicators/NewUpdateIndicator';
import NavigationControlsContainer from './NavigationControlsContainer';
import ChangeThemeBtn from './special_controls/ChangeThemeBtn';
import GoToMainPlayerBtn from './special_controls/GoToMainPlayerBtn';
import WindowControlsContainer from './WindowControlsContainer';

const TitleBar = memo(() => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const playerType = useStore(store, (state) => state.playerType);

  return (
    <header
      id="title-bar"
      className={`text-font-color-black dark:text-font-color-white relative top-0 z-40 grid h-10 w-full grid-cols-[clamp(10rem,30%,18rem)_1fr_auto] items-center justify-between overflow-hidden bg-transparent transition-opacity ${
        bodyBackgroundImage &&
        'bg-background-color-1/50 text-font-color-white! dark:bg-dark-background-color-1/70 backdrop-blur-md'
      }`}
    >
      <div className="logo-and-app-name-and-navigation-controls-container ml-2 flex h-full w-fit items-center gap-12">
        <div className="logo-and-app-name-container flex items-center">
          <span className="logo-container">
            <Img
              className="mr-2 h-7 rounded-md p-1 shadow-md"
              src={LightModeLogo}
              alt="SyncTax Logo"
            />
          </span>
          <span className="app-name-container">
            <span>
              SyncTax
            </span>
          </span>
        </div>
        {playerType !== 'full' ? <NavigationControlsContainer /> : <div />}
      </div>
      {window.api.properties.isInDevelopment ? <CurrentLocationContainer /> : <div />}
      <div className="window-controls-and-special-controls-and-indicators-container flex h-full flex-row">
        <div className="special-controls-and-indicators-container mr-2 flex items-center justify-between py-1">
          <div className="indicators-container flex flex-row">
            {/* <ThrottlingIndicator /> */}
            <NewUpdateIndicator />
            <NetworkIndicator />
          </div>
          <div className="special-controls-container flex flex-row">
            {window.api.properties.isInDevelopment && <ChangeThemeBtn />}
            {playerType === 'full' && <GoToMainPlayerBtn />}
          </div>
        </div>
        <WindowControlsContainer />
      </div>
    </header>
  );
});

TitleBar.displayName = 'TitleBar';
export default TitleBar;
