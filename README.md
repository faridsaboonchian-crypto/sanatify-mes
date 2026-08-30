# MyFactoryApp

An Expo React Native app created with TypeScript template.

## Prerequisites

- Node.js installed at `C:\Program Files\nodejs\`
- npm (comes with Node.js)

## Setup Instructions

### Fix PATH Issue (if Node.js is not recognized)

If you get "node is not recognized" error, you need to add Node.js to your PATH:

**Option 1: For current PowerShell session:**
```powershell
$env:Path += ";C:\Program Files\nodejs"
```

**Option 2: Permanently (recommended):**
1. Open System Properties → Environment Variables
2. Under "System variables", find "Path" and click "Edit"
3. Click "New" and add: `C:\Program Files\nodejs`
4. Click "OK" on all dialogs
5. Restart your terminal

### Install Dependencies

Run one of these commands:

```powershell
# Option 1: Using the installation script
powershell.exe -ExecutionPolicy Bypass -File .\install-dependencies.ps1

# Option 2: Manual installation (after fixing PATH)
npm install
```

### Start the App

```powershell
npm start
```

This will start the Expo development server. You can then:
- Press `a` to open on Android emulator
- Press `i` to open on iOS simulator
- Press `w` to open in web browser
- Scan the QR code with Expo Go app on your phone

## Project Structure

```
MyFactoryApp/
├── App.tsx          # Main app component
├── app.json         # Expo configuration
├── package.json     # Dependencies and scripts
├── tsconfig.json    # TypeScript configuration
└── assets/          # Images and other assets
```

## Available Scripts

- `npm start` - Start Expo development server
- `npm run android` - Start on Android
- `npm run ios` - Start on iOS
- `npm run web` - Start on web

## Troubleshooting

If npm install fails:
1. Make sure Node.js is properly installed
2. Check that the PATH includes Node.js directory
3. Try running: `npm cache clean --force`
4. Delete `node_modules` folder and `package-lock.json` (if exists) and try again


