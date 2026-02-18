/**
 * Category Aliases
 *
 * Maps alternative category names to canonical category IDs.
 * 28 canonical categories as of 2026-02.
 */

export const categoryAliases: Record<string, string> = {
  // email
  'transactional email': 'email',
  'transactional-email': 'email',
  mail: 'email',
  smtp: 'email',

  // payments
  payment: 'payments',
  'payment processing': 'payments',
  billing: 'payments',
  subscriptions: 'payments',

  // auth
  authentication: 'auth',
  login: 'auth',
  'user management': 'auth',
  identity: 'auth',

  // sms
  texting: 'sms',
  messaging: 'sms',

  // storage
  'file storage': 'storage',
  uploads: 'storage',
  blobs: 'storage',
  s3: 'storage',

  // database
  postgres: 'database',
  mysql: 'database',
  db: 'database',
  sql: 'database',

  // monitoring (absorbs audit-logging)
  'error tracking': 'monitoring',
  observability: 'monitoring',
  logging: 'monitoring',
  apm: 'monitoring',
  'audit log': 'monitoring',
  'audit trail': 'monitoring',
  compliance: 'monitoring',
  governance: 'monitoring',

  // search
  'full-text search': 'search',

  // push
  'push notifications': 'push',
  notifications: 'push',

  // ai (absorbs ai-orchestration, ai-memory, document-processing)
  llm: 'ai',
  'language model': 'ai',
  gpt: 'ai',
  claude: 'ai',
  'agent framework': 'ai',
  'ai agents': 'ai',
  langchain: 'ai',
  'ai workflow': 'ai',
  orchestration: 'ai',
  'ai memory': 'ai',
  'long-term memory': 'ai',
  'context management': 'ai',
  'document parsing': 'ai',
  'document extraction': 'ai',
  chunking: 'ai',
  ocr: 'ai',
  'pdf parsing': 'ai',

  // finance (merges financial-data + trading)
  'stock data': 'finance',
  'market data': 'finance',
  'stock api': 'finance',
  stocks: 'finance',
  'stock market': 'finance',
  'financial api': 'finance',
  finance: 'finance',
  brokerage: 'finance',
  'stock trading': 'finance',
  'trade execution': 'finance',
  'order execution': 'finance',
  broker: 'finance',
  'buy stocks': 'finance',
  'sell stocks': 'finance',
  'crypto trading': 'finance',

  // maps
  geocoding: 'maps',
  mapping: 'maps',
  geolocation: 'maps',

  // jobs
  'background jobs': 'jobs',
  'job queue': 'jobs',
  'task queue': 'jobs',
  workers: 'jobs',
  cron: 'jobs',

  // vector-db
  'vector database': 'vector-db',
  'vector store': 'vector-db',
  embeddings: 'vector-db',
  pinecone: 'vector-db',
  rag: 'vector-db',
  'semantic search': 'vector-db',

  // ai-audio
  'text to speech': 'ai-audio',
  tts: 'ai-audio',
  'speech to text': 'ai-audio',
  stt: 'ai-audio',
  'audio generation': 'ai-audio',
  'voice ai': 'ai-audio',
  'voice synthesis': 'ai-audio',
  transcription: 'ai-audio',
  'music generation': 'ai-audio',

  // ai-video
  'video generation': 'ai-video',
  'text to video': 'ai-video',
  'ai video': 'ai-video',
  'video ai': 'ai-video',

  // ai-image
  'image generation': 'ai-image',
  'text to image': 'ai-image',
  'ai image': 'ai-image',
  'image ai': 'ai-image',
  diffusion: 'ai-image',
  'stable diffusion': 'ai-image',
  dall_e: 'ai-image',
  midjourney: 'ai-image',

  // feature-flags
  'feature flag': 'feature-flags',
  'feature flags': 'feature-flags',
  'feature toggle': 'feature-flags',
  'a/b testing': 'feature-flags',

  // message-queue
  'message queue': 'message-queue',
  'message broker': 'message-queue',
  kafka: 'message-queue',
  rabbitmq: 'message-queue',
  pubsub: 'message-queue',
  'event streaming': 'message-queue',

  // cache (renamed from cache-kv)
  cache: 'cache',
  redis: 'cache',
  memcached: 'cache',
  'key value': 'cache',
  kv: 'cache',
  'in memory': 'cache',

  // realtime
  realtime: 'realtime',
  websocket: 'realtime',
  websockets: 'realtime',
  'server sent events': 'realtime',
  sse: 'realtime',
  'live updates': 'realtime',
  presence: 'realtime',

  // chat (new)
  chat: 'chat',
  'live chat': 'chat',
  'chat api': 'chat',
  'in-app messaging': 'chat',

  // hosting (new)
  hosting: 'hosting',
  deployment: 'hosting',
  paas: 'hosting',
  'cloud hosting': 'hosting',

  // cdn (new)
  cdn: 'cdn',
  'content delivery': 'cdn',
  'edge network': 'cdn',

  // cms (new)
  cms: 'cms',
  'content management': 'cms',
  'headless cms': 'cms',

  // media (new — absorbs video)
  media: 'media',
  'media processing': 'media',
  'image processing': 'media',
  'video streaming': 'media',
  'video hosting': 'media',
  'live streaming': 'media',

  // web-search (new)
  'web search': 'web-search',
  'web retrieval': 'web-search',
  serp: 'web-search',
  'web scraping api': 'web-search',
};
