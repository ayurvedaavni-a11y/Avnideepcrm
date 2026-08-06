# AVNIDEEP CRM PRO - Windows EXE Desktop Build Guide

Follow these steps to compile this web application into a fully offline desktop app for Windows (.exe) with automatic installer creation:

## Prerequisites
1. Install [Node.js](https://nodejs.org) (v18 or later recommended).
2. Install dependencies:
   ```bash
   npm install
   ```

## Local Desktop Development
To test the desktop app wrapper locally:
1. Install Electron:
   ```bash
   npm install -D electron
   ```
2. Start the desktop window pointing to localhost development server:
   ```bash
   # Run development dev server
   npm run dev
   
   # Run Electron app concurrently
   npx electron electron/main.js
   ```

## Packing into Windows EXE Installer
We recommend using **electron-builder** to package your production workspace.

1. Install `electron-builder` as a devDependency:
   ```bash
   npm install -D electron-builder
   ```

2. Add the following fields to your `package.json` build definition:
   ```json
   "main": "electron/main.js",
   "build": {
     "appId": "com.avnideep.crmpro",
     "productName": "AvnideepCRMPro",
     "win": {
       "target": "nsis",
       "icon": "electron/icon.png"
     },
     "nsis": {
       "oneClick": false,
       "allowToChangeInstallationDirectory": true,
       "createDesktopShortcut": true,
       "createStartMenuShortcut": true,
       "shortcutName": "Avnideep CRM Pro"
     },
     "files": [
       "dist/**/*",
       "electron/**/*"
     ]
   }
   ```

3. Build the assets and run packager:
   ```bash
   # Compile React app into single-file dist assets
   npm run build
   
   # Package and generate Windows EXE
   npx electron-builder build --win
   ```

The installable EXE installer will be generated inside the `dist/` or `build/` directory, complete with desktop shortcuts, start menu integrations, offline database adapters, and automated backup hooks!
