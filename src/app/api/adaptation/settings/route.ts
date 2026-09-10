import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SETTINGS_FILE = path.join(process.cwd(), '.novel', 'adaptation', 'settings.json')

// GET: 获取改编设置
export async function GET() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    const settings = JSON.parse(data)
    return NextResponse.json({ success: true, data: settings })
  } catch (err: any) {
    // 文件不存在返回空设置
    if (err.code === 'ENOENT') {
      return NextResponse.json({ success: true, data: null })
    }
    console.error('[adaptation/settings] GET failed', err)
    return NextResponse.json({ error: '读取设置失败' }, { status: 500 })
  }
}

// POST: 保存改编设置
export async function POST(req: NextRequest) {
  try {
    // 确保正确解析 UTF-8 编码的 JSON
    const text = await req.text()
    const settings = JSON.parse(text)

    // 确保目录存在
    const dir = path.dirname(SETTINGS_FILE)
    await fs.mkdir(dir, { recursive: true })

    // 保存设置（确保 UTF-8 编码）
    const jsonStr = JSON.stringify(settings, null, 2)
    await fs.writeFile(SETTINGS_FILE, jsonStr, 'utf-8')

    console.log('[adaptation/settings] 设置已保存到:', SETTINGS_FILE)
    return NextResponse.json({ success: true, message: '设置已保存' })
  } catch (err: any) {
    console.error('[adaptation/settings] POST failed', err)
    return NextResponse.json({ error: err.message || '保存设置失败' }, { status: 500 })
  }
}
