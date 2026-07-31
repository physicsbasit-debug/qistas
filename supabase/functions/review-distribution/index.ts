import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const responseSchema = {
  type: 'object',
  properties: {
    recommendedScenario: { type: 'string', enum: ['balanced', 'specialized', 'compact', 'none'] },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    suggestedActions: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  required: ['recommendedScenario', 'summary', 'strengths', 'warnings', 'suggestedActions'],
};

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash';
    const input = await request.json();

    const prompt = `أنت مراجع تربوي متخصص في توزيع أنصبة المعلمين.\nراجع السيناريوهات المولدة حسابيًا ولا تخترع بيانات جديدة.\nاختر الأنسب وفق الأولويات: عدم وجود تكليفات غير مسندة، عدم تجاوز سقف النصاب، احترام خيارات المستخدم، تقارب الأنصبة، ثم تقليل التشعب.\nإذا كانت البيانات غير كافية اختر none.\nالبيانات:\n${JSON.stringify(input)}`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      },
    );

    const result = await geminiResponse.json();
    if (!geminiResponse.ok) {
      throw new Error(result?.error?.message || 'Gemini request failed.');
    }
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    const parsed = JSON.parse(text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
});
