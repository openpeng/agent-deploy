// Agent Bridge Server — HTTP→AI 桥接服务
// 接收前端请求，调用 LLM 生成 Agent 配置

import express from 'express';

const app = express();
app.use(express.json());

// 配置
const PORT = parseInt(process.env.PORT || '3210', 10);
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:11434/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';

// AI 生成 Agent 配置的 System Prompt
const SYSTEM_PROMPT = `你是一个 Agent 配置生成器。根据用户的描述，生成完整的 Agent 配置 JSON。

## 输出格式要求
输出必须是一个合法的 JSON 对象，严格遵循以下 schema：

{
  "name": "kebab-case-name",
  "version": "1.0.0",
  "icon": "emoji",
  "developer": "开发者名称",
  "description": {
    "summary": "一句话简介(20-50字)",
    "detail": "详细描述(100-300字)",
    "examples": ["使用示例1", "示例2"]
  },
  "categories": ["分类"],
  "skills": [
    {
      "skillId": "skill-id",
      "name": "Skill名称",
      "version": "1.0.0",
      "description": "描述",
      "icon": "🛠️",
      "category": "分类",
      "parameters": {},
      "priority": 0,
      "isOfficial": false
    }
  ],
  "mcpTools": [
    {
      "toolId": "tool-id",
      "name": "工具名称",
      "description": "描述",
      "icon": "🔌",
      "category": "分类",
      "config": {},
      "permissions": [],
      "isConnected": false
    }
  ],
  "welcomeMessage": "用户打开对话时的欢迎语",
  "sampleInputs": ["快速开始示例1", "示例2"]
}

## 规则
1. 只输出 JSON，不要输出任何其他文字、解释或 markdown 代码块标记
2. name 使用 kebab-case（小写字母、数字、连字符）
3. icon 从以下选择一个最合适的: 🤖📊✍️🔍💬🛠️🎨📋
4. categories 从以下选择1-2个最合适的: 办公效率/数据分析/内容创作/开发工具/客户服务/教育学习
5. 根据用户请求推断最合适的 skills 和 mcpTools（如果用户没有明确要求，推荐2-3个相关的）
6. welcomeMessage 应该友好且说明 Agent 的核心能力
7. sampleInputs 应该是用户最可能输入的2-3个典型请求
8. 确保 JSON 格式合法，可以被 JSON.parse 解析`;

// 调用 LLM API
async function callLLM(userMessage: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (LLM_API_KEY) {
    headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
  }

  const res = await fetch(LLM_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`LLM API错误 (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  // OpenAI 兼容格式
  return data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
}

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// AI 生成配置
app.post('/api/generate-config', async (req, res) => {
  const { userRequest } = req.body;

  if (!userRequest || typeof userRequest !== 'string') {
    res.status(400).json({ success: false, error: '缺少 userRequest 参数' });
    return;
  }

  try {
    const rawText = await callLLM(userRequest);

    // 尝试从返回中提取 JSON
    let config: any = null;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        config = JSON.parse(jsonMatch[0]);
      } catch {
        // JSON 解析失败
      }
    }

    if (config) {
      res.json({ success: true, config });
    } else {
      res.json({ success: false, rawText, error: '无法从AI返回中提取有效JSON' });
    }
  } catch (error: any) {
    console.error('生成配置失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Agent Bridge Server 运行在 http://localhost:${PORT}`);
  console.log(`LLM API: ${LLM_API_URL}`);
  console.log(`LLM Model: ${LLM_MODEL}`);
});

export default app;
