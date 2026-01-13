# StudyLoop Deployment: Vercel + Hugging Face

## Architecture
- **Frontend**: Vercel (Static hosting)
- **Backend**: Hugging Face Spaces (FastAPI Docker)
- **AI**: Hugging Face Inference API

## Quick Deployment Checklist

### Backend (Hugging Face)
1. ✅ Create Hugging Face account
2. ✅ Create new Space with Docker SDK
3. ✅ Add HF_API_KEY as secret
4. ✅ Upload backend files to Space
5. ✅ Note Space URL: `https://[username]-[space-name].hf.space`

### Frontend (Vercel)
1. ✅ Create Vercel account
2. ✅ Push frontend to GitHub
3. ✅ Import to Vercel
4. ✅ Update `app.js` with your Hugging Face URL
5. ✅ Deploy and note Vercel URL: `https://[project-name].vercel.app`

## Testing Your Deployment

1. **Test Backend**:
   ```bash
   curl https://your-username-studyloop-api.hf.space/health