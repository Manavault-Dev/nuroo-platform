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
      { url: 'https://api.usenuroo.com/v1', description: 'Production' },
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
      { name: 'System', description: 'Health, session, user profile, plans' },
      { name: 'Auth', description: 'Password reset, Google Calendar OAuth' },
      { name: 'Organizations', description: 'Create and manage organizations' },
      { name: 'Team', description: 'Team members, invites, branches' },
      { name: 'Children', description: 'Child profiles, records, intake, timeline' },
      { name: 'Booking', description: 'Specialist slots, booking, scheduling' },
      { name: 'Cohorts', description: 'Group programs, participants, sessions' },
      { name: 'Courses', description: 'Online courses, modules, lessons' },
      { name: 'Events', description: 'Events and registrations' },
      { name: 'Finance', description: 'Finance overview, attendance reports' },
      { name: 'Payments', description: 'Billing, invoices, subscriptions, webhooks' },
      { name: 'Groups', description: 'Internal groups and assignments' },
      { name: 'Messaging', description: 'Conversations and messages' },
      { name: 'AI', description: 'AI assistant, task generation, reports' },
      { name: 'Content', description: 'Roadmaps and task templates' },
      { name: 'Marketplace', description: 'Public discovery, favorites, reviews' },
      { name: 'Invitations', description: 'Parent invite links and connections' },
      { name: 'Legal', description: 'Consent management, legal documents' },
      { name: 'Notifications', description: 'Push tokens, preferences' },
      { name: 'Verifications', description: 'Child document verification' },
    ],
  },
}

export const swaggerUiConfig: FastifySwaggerUiOptions = {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    persistAuthorization: true,
    tryItOutEnabled: false,
  },
  staticCSP: false,
  transformSpecificationClone: true,
}
