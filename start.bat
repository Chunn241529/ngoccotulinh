@echo off
cd /d "%~dp0"
if not exist vendor\bundle.js (
  echo Bundle missing - running build...
  call npm install
  call npm run build
)
start "" http://localhost:5173
node server.js
