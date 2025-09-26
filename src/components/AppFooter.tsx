import React from 'react';

const AppFooter: React.FC = () => {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <span className="footer-copyright">© 2024</span>
        <span className="footer-brand">Automata Controls</span>
        <span className="footer-powered">powered by</span>
        
        <a 
          href="https://AutomataNexus.com" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="footer-logo-link"
        >
          <img 
            src="/automata-nexus-logo.png?v=2" 
            alt="Automata Nexus AI" 
            className="footer-logo"
          />
        </a>

        <a 
          href="https://github.com/AutomataControls" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="footer-github"
        >
          <i className="fab fa-github"></i>
          <span className="sr-only">GitHub</span>
        </a>
      </div>
    </footer>
  );
};

export default AppFooter;