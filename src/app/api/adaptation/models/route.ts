import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'

export async function GET() {
  try {
    const config = getConfig()

    if (!config.ai.baseUrl || !config.ai.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页面配置 AI 服务地址和 API Key', models: [] },
        { status: 400 }
      )
    }

    const url = `${config.ai.baseUrl}/models`
    console.log('Fetching models from:', url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.ai.apiKey}`
      },
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Models API error:', response.status, errorText)
      return NextResponse.json(
        { error: `获取模型失败: ${response.status}`, models: [] },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('Models response:', JSON.stringify(data).substring(0, 200))

    const models = (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      enabled: true
    }))

    return NextResponse.json({ models })
  } catch (error: any) {
    console.error('Models fetch error:', error)
    return NextResponse.json(
      {
        error: error.message || '获取模型失败',
        models: [],
        hint: error.cause ? JSON.stringify(error.cause) : undefined
      },
      { status: 500 }
    )
  }
}
