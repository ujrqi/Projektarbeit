import React from 'react';
import './header.css';

function Header() {
  return (
    <header className="header">
      <div className="header-top">
        <img src="/assets/Logo_KIT.svg.png" alt="KIT Logo" className="kit-logo" />
      </div>

      <div className="header-banner">
        <img src="/assets/banner.png" alt="Header Banner" className="banner-img" />
        <div className="header-text">
          <h1>Institut für Technik der Informationsverarbeitung (ITIV)</h1>
          <img src="/assets/Logoitiv.png" alt="ITIV Logo" className="itiv-logo" />
        </div>
      </div>
    </header>
  );
}

export default Header;

