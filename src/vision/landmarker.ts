import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export type Delegate = 'GPU' | 'CPU';

export async function createLandmarker(origin: string, delegate: Delegate): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${origin}/mediapipe/face_landmarker.task`, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
}
