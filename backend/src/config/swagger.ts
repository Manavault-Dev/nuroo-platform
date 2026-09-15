/**
 * Swagger / OpenAPI configuration for Nuroo API
 * Docs served at /docs (Swagger UI) and /docs/json (raw OpenAPI spec)
 *
 * Auto-generation: @fastify/swagger introspects every registered Fastify route.
 * Routes with `schema` objects get full param/body/response docs automatically.
 * Routes without schema still appear with correct method + path.
 */
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger'
import type { FastifySwaggerUiOptions } from '@fastify/swagger-ui'

export const swaggerConfig: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: '3.0.3',
    info: {
      title: 'Nuroo API',
      description: [
        '## Nuroo REST API — v1',
        '',
        'Полный REST API платформы Nuroo: организации, дети, специалисты, бронирование, платежи, AI.',
        '',
        '### Аутентификация',
        'Все защищённые эндпоинты требуют **Firebase ID токен**:',
        '```',
        'Authorization: Bearer <firebase_id_token>',
        '```',
        '',
        '### Базовый URL',
        '```',
        'https://api.usenuroo.com/v1',
        '```',
        '',
        '### Роли',
        '| Роль | Описание |',
        '|------|----------|',
        '| `org_admin` | Администратор организации |',
        '| `specialist` | Специалист |',
        '| `parent` | Родитель |',
      ].join('\n'),
      version: '1.0.0',
      contact: {
        name: 'Nuroo Support',
        email: 'support@usenuroo.com',
        url: 'https://usenuroo.com',
      },
    },
    externalDocs: {
      description: 'usenuroo.com',
      url: 'https://usenuroo.com',
    },
    servers: [
      {
        url: 'https://nuroo-backend-872609122621.us-central1.run.app/v1',
        description: 'Production (Cloud Run)',
      },
      { url: 'http://localhost:3101/v1', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Firebase ID Token',
          description: 'Firebase ID token. Get via `firebase.auth().currentUser?.getIdToken()`',
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      {
        name: 'System',
        description:
          '`GET /health` · `GET /v1/me` · `POST /v1/me` — профиль пользователя и определение роли. Вызывается мобильным приложением при каждом запуске.',
      },
      {
        name: 'Auth',
        description:
          'Сброс пароля, OAuth Google Calendar. Firebase ID токен передаётся в заголовке `Authorization: Bearer <token>`.',
      },
      {
        name: 'Organizations',
        description:
          'Создание и редактирование организаций, настройка брендинга. Доступно только роли `org_admin`.',
      },
      {
        name: 'Team',
        description:
          'Участники организации, приглашения, филиалы. Управление ролями: `org_admin` / `specialist`.',
      },
      {
        name: 'Children',
        description: 'Профили детей, медкарты, анкеты intake, таймлайн развития, опекуны.',
      },
      {
        name: 'Booking',
        description: 'Слоты специалиста, создание, отмена и перенос записей, расписание.',
      },
      {
        name: 'Cohorts',
        description: 'Групповые программы, участники, сессии, посещаемость, лист ожидания.',
      },
      {
        name: 'Courses',
        description: 'Онлайн-курсы, модули, уроки, прогресс. Маркетплейс курсов для родителей.',
      },
      {
        name: 'Events',
        description: 'Создание мероприятий, регистрация участников.',
      },
      {
        name: 'Finance',
        description:
          'Обзор доходов, отчёты посещаемости, статистика оплат. Только для плана `nuroo_business`.',
      },
      {
        name: 'Payments',
        description: 'Биллинг, счета, подписки, вебхуки платёжных провайдеров (Finik, Stripe).',
      },
      {
        name: 'Groups',
        description: 'Внутренние группы организации, назначения заданий.',
      },
      {
        name: 'Messaging',
        description: 'Чаты между специалистом и родителем, заметки.',
      },
      {
        name: 'AI',
        description: 'AI-ассистент: генерация задач для ребёнка, отчёты, рекомендации специалиста.',
      },
      {
        name: 'Content',
        description: 'Дорожные карты развития, шаблоны заданий.',
      },
      {
        name: 'Marketplace',
        description: 'Публичный поиск организаций и специалистов, избранное, отзывы.',
      },
      {
        name: 'Invitations',
        description: 'Ссылки для родителей, подключение к организации, принятие инвайтов.',
      },
      {
        name: 'Legal',
        description: 'Управление юридическими согласиями пользователей.',
      },
      {
        name: 'Notifications',
        description: 'Push-токены устройств, настройки уведомлений.',
      },
      {
        name: 'Verifications',
        description: 'Проверка документов ребёнка.',
      },
    ],
  },
}

export const swaggerUiConfig: FastifySwaggerUiOptions = {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'none',
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    persistAuthorization: true,
    tryItOutEnabled: false,
    defaultModelsExpandDepth: -1,
    defaultModelExpandDepth: 3,
    displayOperationId: false,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
    syntaxHighlight: { theme: 'monokai' },
    layout: 'BaseLayout',
  },
  theme: {
    title: 'Nuroo API Docs',
    favicon: [
      {
        filename: 'favicon.png',
        rel: 'icon',
        sizes: '32x32',
        type: 'image/png',
        content: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAB' +
            'mklEQVRYhe2Xv0oDQRDGf3uXxCIWsUkhFoKFjQcWQrCwsbGwsLGwsLCwsQiCCIKIiIiIiIiI' +
            'iIiIiIiIiIiIiIiIiIiIiOiFF3Y3m52d2dk5AiGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQggh' +
            'hBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYT4Z7wDZ8BlYA3YAY6B0+YZMAEWwDdwDSwD96r5' +
            'BXgClsBHYLN5BjYHAAAASUVORK5CYII=',
          'base64'
        ),
      },
    ],
  },
  staticCSP: false,
  transformSpecificationClone: true,
  logo: {
    type: 'image/svg+xml',
    content: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32">
        <rect width="120" height="32" rx="6" fill="#179C95"/>
        <text x="12" y="22" font-family="system-ui,sans-serif" font-weight="700"
          font-size="16" fill="white" letter-spacing="-0.5">Nuroo API</text>
      </svg>`
    ),
  },
}
