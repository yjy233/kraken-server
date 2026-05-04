/**
 * 启动引导模块
 * 必须在 server.ts 中作为第一个 import，确保 .env 在所有其他模块读取 process.env 之前生效。
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

loadDotEnv({ path: path.join(ROOT_DIR, '.env') })
loadDotEnv({ path: path.join(ROOT_DIR, '.env.local'), override: true })
