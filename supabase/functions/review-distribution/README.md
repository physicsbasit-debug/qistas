# review-distribution

وظيفة خادمية لمراجعة السيناريوهات عبر Gemini مع Structured Output.

الأسرار المطلوبة:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` اختياري، الافتراضي `gemini-3.6-flash`

مثال النشر:

```bash
supabase functions deploy review-distribution
supabase secrets set GEMINI_API_KEY=YOUR_KEY
```
