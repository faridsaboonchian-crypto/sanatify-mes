# Quick Start Guide

## Step 1: Fix PATH (Required)

Open a **NEW** PowerShell window and run:

```powershell
$env:Path += ";C:\Program Files\nodejs"
```

Or add it permanently to your system PATH (see README.md for details).

## Step 2: Verify Installation

```powershell
node -v
npm -v
```

Both commands should show version numbers.

## Step 3: Install Dependencies

```powershell
cd D:\MyFactoryApp
npm install
```

Wait for installation to complete (this may take 2-5 minutes).

## Step 4: Start the App

```powershell
npm start
```

## Alternative: Use the Installation Script

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-dependencies.ps1
```

## Project Files Created

✅ `package.json` - Dependencies and scripts
✅ `App.tsx` - Main React Native component  
✅ `app.json` - Expo configuration
✅ `tsconfig.json` - TypeScript configuration
✅ `.gitignore` - Git ignore rules
✅ `assets/` - Directory for images and assets

## Next Steps

After `npm install` completes:
1. Run `npm start` to launch Expo
2. Install Expo Go app on your phone
3. Scan the QR code to view your app


