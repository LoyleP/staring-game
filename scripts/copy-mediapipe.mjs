// Copie les fichiers WASM de MediaPipe depuis node_modules vers public/ (servis en local, version épinglée).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/mediapipe', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
