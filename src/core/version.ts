import { createRequire } from 'node:module'

// src/core 와 dist/core 모두 저장소 루트에서 두 단계 아래라 같은 경로로 읽힌다.
const require = createRequire(import.meta.url)
export const VERSION: string = require('../../package.json').version
