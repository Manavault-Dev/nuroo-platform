/**
 * Integration tests for POST /api/parent/ai/ask — specifically the
 * search_providers tool-calling flow: the model should only recommend real
 * marketplace orgs (never invented ones), surfaced to the client as
 * structured `recommendations` cards alongside the text reply.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const ORGS: Record<string, Record<string, unknown>> = {
  org_speech_1: {
    name: 'Речь и Я',
    logoUrl: 'https://example.com/logo1.png',
    city: 'Бишкек',
    categories: ['speech therapy', 'early intervention'],
    ageMin: 2,
    ageMax: 7,
    description: 'Speech therapy center',
    isPublicMarketplaceEnabled: true,
  },
  org_aba_1: {
    name: 'АВА Центр',
    logoUrl: null,
    city: 'Бишкек',
    categories: ['aba'],
    ageMin: 3,
    ageMax: 12,
    description: 'ABA therapy',
    isPublicMarketplaceEnabled: true,
  },
  org_hidden: {
    name: 'Draft Org',
    logoUrl: null,
    city: 'Бишкек',
    categories: ['speech therapy'],
    ageMin: 1,
    ageMax: 5,
    description: 'not yet public',
    isPublicMarketplaceEnabled: false,
  },
  org_speech_ru: {
    name: 'Речевой Центр',
    logoUrl: null,
    city: 'Бишкек',
    // Deliberately NOT tagged "speech therapy" — proves the match below
    // comes from the Russian description, not the English category tag.
    categories: ['other'],
    ageMin: 2,
    ageMax: 10,
    description: 'У нас работают опытные логопеды и дефектологи.',
    isPublicMarketplaceEnabled: true,
  },
}

const TEST_UID = 'test-parent-uid'

/** uid -> persisted chat message docs, so loadChatHistory/appendChatTurn can
 * be exercised end-to-end (seed history in, read it back via GET /history or
 * as conversation memory on the next /ask call). */
let chatStore: Record<
  string,
  { id: string; role: string; content: string; recommendations?: unknown[]; createdAt: Date }[]
>
let docCounter = 0

function resetChatStore() {
  chatStore = {}
  docCounter = 0
}

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'organizations') {
        return {
          where: vi.fn((field: string, _op: string, value: unknown) => ({
            limit: vi.fn(() => ({
              get: vi.fn(async () => ({
                docs: Object.entries(ORGS)
                  .filter(([, data]) => data[field] === value)
                  .map(([id, data]) => ({ id, data: () => data })),
              })),
            })),
          })),
        }
      }
      const match = name.match(/^userAiChats\/(.+)\/messages$/)
      if (match) {
        const uid = match[1]
        return {
          orderBy: vi.fn(() => ({
            limit: vi.fn((n: number) => ({
              get: vi.fn(async () => {
                const docs = (chatStore[uid] ?? [])
                  .slice()
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, n)
                  .map((d) => ({ id: d.id, data: () => d }))
                return { docs }
              }),
            })),
          })),
          doc: vi.fn(() => ({ id: `msg_${docCounter++}`, _uid: uid })),
        }
      }
      throw new Error(`unexpected collection ${name}`)
    }),
    batch: vi.fn(() => ({
      set: vi.fn((ref: { id: string; _uid: string }, data: Record<string, unknown>) => {
        chatStore[ref._uid] = chatStore[ref._uid] ?? []
        chatStore[ref._uid].push({ id: ref.id, ...data } as (typeof chatStore)[string][number])
      }),
      commit: vi.fn(async () => undefined),
    })),
  })),
}))

async function buildApp(opts: { authenticated?: boolean } = {}): Promise<FastifyInstance> {
  process.env.OPENAI_API_KEY = 'test-key'
  const app = Fastify({ logger: false })
  if (opts.authenticated !== false) {
    app.addHook('onRequest', async (request) => {
      ;(request as unknown as { user: { uid: string } }).user = { uid: TEST_UID }
    })
  }
  const { parentAiRoute } = await import('../parentAi.routes.js')
  await app.register(parentAiRoute)
  await app.ready()
  return app
}

describe('POST /api/parent/ai/ask', () => {
  let app: FastifyInstance
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    resetChatStore()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    app = await buildApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns a plain reply with no recommendations when the model does not call the tool', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ABA stands for Applied Behavior Analysis.' } }],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'What is ABA?', language: 'en' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.reply).toBe('ABA stands for Applied Behavior Analysis.')
    expect(body.recommendations).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1) // no second round-trip needed
  })

  it('falls back to a category-only search when an over-narrow query (e.g. a diagnosis) hides real matches', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_providers',
                      // The model folded the child's diagnosis into `query` —
                      // no org's text literally mentions autism, so the
                      // strict match would wrongly come back empty.
                      arguments: JSON.stringify({ category: 'speech therapy', query: 'autism' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Here is a speech therapy center that can help.' } }],
        }),
      })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'Find a speech therapist for my son with autism', language: 'en' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0]).toMatchObject({ id: 'org_speech_1', name: 'Речь и Я' })
  })

  it('finds a provider via its description when the category argument is in a different language than the tag', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_providers',
                      // The platform's categories are tagged in English only;
                      // this simulates the model passing the parent's own
                      // Russian wording straight through.
                      arguments: JSON.stringify({ category: 'логопед' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Нашёл логопедический центр для вас.' } }],
        }),
      })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'Дай мне куда мне отвести ребенка на логопеда', language: 'ru' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0]).toMatchObject({ id: 'org_speech_ru', name: 'Речевой Центр' })
  })

  it('searches real providers and returns only public, matching orgs as recommendations', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_providers',
                      arguments: JSON.stringify({ category: 'speech therapy', childAge: 4 }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'I found "Речь и Я" — a speech therapy center in Бишкек for ages 2–7.',
              },
            },
          ],
        }),
      })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'Find a speech therapist for my 4-year-old', language: 'en' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.reply).toContain('Речь и Я')
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0]).toMatchObject({
      id: 'org_speech_1',
      name: 'Речь и Я',
      city: 'Бишкек',
    })
    // the draft (non-public) org and the unrelated ABA org must never appear
    expect(body.recommendations.map((r: { id: string }) => r.id)).not.toContain('org_hidden')
    expect(body.recommendations.map((r: { id: string }) => r.id)).not.toContain('org_aba_1')

    // second OpenAI call must include the tool result so the final reply is grounded
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMessage = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMessage.content).toContain('Речь и Я')
  })

  it('tells the model honestly when no providers match, instead of letting it invent one', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_providers',
                      arguments: JSON.stringify({ category: 'music therapy' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "I couldn't find a music therapy provider on Nuroo right now.",
              },
            },
          ],
        }),
      })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'Find a music therapist', language: 'en' },
    })

    const body = res.json()
    expect(body.recommendations).toEqual([])

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMessage = secondCallBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMessage.content).toContain('No matching providers')
  })

  it('rejects an unauthenticated request', async () => {
    const unauthedApp = await buildApp({ authenticated: false })

    const res = await unauthedApp.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'Find a speech therapist', language: 'en' },
    })

    expect(res.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists the exchange so the chat survives a remount', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ABA stands for Applied Behavior Analysis.' } }],
      }),
    })

    await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'What is ABA?', language: 'en' },
    })

    const stored = chatStore[TEST_UID]
    expect(stored).toHaveLength(2)
    expect(stored[0]).toMatchObject({ role: 'user', content: 'What is ABA?' })
    expect(stored[1]).toMatchObject({
      role: 'assistant',
      content: 'ABA stands for Applied Behavior Analysis.',
    })
  })

  it('sends prior turns back to the model as conversation memory', async () => {
    const now = new Date()
    chatStore[TEST_UID] = [
      {
        id: 'seed_1',
        role: 'user',
        content: 'My son is 4 and has a speech delay.',
        createdAt: now,
      },
      {
        id: 'seed_2',
        role: 'assistant',
        content: "Got it, I'll keep that in mind.",
        createdAt: new Date(now.getTime() + 1),
      },
    ]

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Based on what you told me, here are some tips.' } }],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/ai/ask',
      payload: { message: 'What should I do next?', language: 'en' },
    })

    expect(res.statusCode).toBe(200)
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(firstCallBody.messages).toEqual(
      expect.arrayContaining([
        { role: 'user', content: 'My son is 4 and has a speech delay.' },
        { role: 'assistant', content: "Got it, I'll keep that in mind." },
        { role: 'user', content: 'What should I do next?' },
      ])
    )
  })
})

describe('GET /api/parent/ai/history', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    resetChatStore()
    app = await buildApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('rejects an unauthenticated request', async () => {
    const unauthedApp = await buildApp({ authenticated: false })
    const res = await unauthedApp.inject({ method: 'GET', url: '/api/parent/ai/history' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the persisted thread in chronological order, including recommendation cards', async () => {
    const now = new Date()
    chatStore[TEST_UID] = [
      {
        id: 'seed_2',
        role: 'assistant',
        content: 'Here is a speech therapist.',
        recommendations: [{ id: 'org_speech_1', name: 'Речь и Я' }],
        createdAt: new Date(now.getTime() + 1),
      },
      { id: 'seed_1', role: 'user', content: 'Find a speech therapist', createdAt: now },
    ]

    const res = await app.inject({ method: 'GET', url: '/api/parent/ai/history' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toMatchObject({ role: 'user', content: 'Find a speech therapist' })
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Here is a speech therapist.',
      recommendations: [{ id: 'org_speech_1', name: 'Речь и Я' }],
    })
    expect(typeof body.messages[0].createdAt).toBe('number')
  })

  it('returns an empty list for a parent with no chat history yet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parent/ai/history' })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages).toEqual([])
  })
})
