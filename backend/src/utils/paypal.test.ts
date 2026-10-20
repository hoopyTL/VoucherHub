import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capturePayPalOrder, convertVndToUsd, createPayPalOrder } from './paypal'

const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

beforeEach(() => {
  vi.stubEnv('PAYPAL_CLIENT_ID', 'synthetic-client')
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'synthetic-secret')
  vi.stubEnv('PAYPAL_VND_PER_USD', '25000')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PayPal sandbox adapter (external transport mocked; no provider calls)', () => {
  it('creates an approval request with the order reference and converted amount', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'synthetic-token' })).mockResolvedValueOnce(
      response({
        id: 'provider-order',
        links: [
          { rel: 'self', href: 'unused' },
          { rel: 'payer-action', href: 'https://example.invalid/approve' }
        ]
      })
    )
    expect(await createPayPalOrder({ orderId: 'internal-order', amountVnd: 100000 })).toEqual({
      paypalOrderId: 'provider-order',
      approvalUrl: 'https://example.invalid/approve',
      amountUsd: '4.00'
    })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders')
    expect(JSON.parse(String(init?.body)).purchase_units[0]).toMatchObject({
      reference_id: 'internal-order',
      amount: { currency_code: 'USD', value: '4.00' }
    })
  })

  it('captures an order using a stable request id and reads its capture reference', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'synthetic-token' })).mockResolvedValueOnce(
      response({
        id: 'provider-order',
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'capture-1', status: 'COMPLETED' }] } }]
      })
    )
    expect(await capturePayPalOrder('provider-order')).toMatchObject({ status: 'COMPLETED', captureId: 'capture-1' })
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      'PayPal-Request-Id': 'voucherhub-capture-provider-order'
    })
  })

  it('returns a nullable capture reference for pending provider outcomes', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(response({ status: 'PENDING' }))
    expect(await capturePayPalOrder('pending')).toMatchObject({ status: 'PENDING', captureId: null })
  })

  it('rejects missing credentials before making any network request', async () => {
    vi.stubEnv('PAYPAL_CLIENT_SECRET', '')
    await expect(capturePayPalOrder('order')).rejects.toThrow('chưa được cấu hình')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', 'not-a-number'])('rejects invalid conversion rate %s', (rate) => {
    vi.stubEnv('PAYPAL_VND_PER_USD', rate)
    expect(() => convertVndToUsd(100000)).toThrow('không hợp lệ')
  })

  it.each([{ error_description: 'Denied' }, {}])('rejects invalid OAuth responses: %j', async (data) => {
    fetchMock.mockResolvedValueOnce(response(data, 401))
    await expect(capturePayPalOrder('order')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([{ message: 'Invalid capture' }, {}])(
    'propagates provider failure without claiming completion: %j',
    async (data) => {
      fetchMock.mockResolvedValueOnce(response({ access_token: 'token' })).mockResolvedValueOnce(response(data, 422))
      await expect(capturePayPalOrder('order')).rejects.toThrow()
    }
  )

  it('rejects approval responses that have no payer action link', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(response({ id: 'order', links: [] }))
    await expect(createPayPalOrder({ orderId: 'order', amountVnd: 100000 })).rejects.toThrow('đường dẫn phê duyệt')
  })
})
