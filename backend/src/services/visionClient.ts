import vision from '@google-cloud/vision';

let client: InstanceType<typeof vision.ImageAnnotatorClient> | null = null;

export function getVisionClient() {
  if (client) return client;

  const raw = process.env.GOOGLE_VISION_KEY;
  if (!raw) throw new Error('GOOGLE_VISION_KEY missing');

  const credentials = JSON.parse(raw);
  const projectId = credentials.project_id;
  if (!projectId) throw new Error('project_id missing');

  client = new vision.ImageAnnotatorClient({
    credentials,
    projectId,
  });

  console.log('[VISION] client initialized');

  return client;
}

export default getVisionClient;
