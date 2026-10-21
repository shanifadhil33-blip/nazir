import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { addKnowledgePdf, PdfValidation, readPdfForm } from '@/server/knowledge/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const language = requestLanguage(request);
  return memberRoute(workspaceId, async (memberId) => {
    try {
      return await addKnowledgePdf(runtimeDriver(), memberId, await readPdfForm(request));
    } catch (error) {
      if (error instanceof PdfValidation) return Response.json({ error: { code: 'validation', message: error.messageFor(language) } }, { status: 400 });
      throw error;
    }
  }, 201, language);
}
