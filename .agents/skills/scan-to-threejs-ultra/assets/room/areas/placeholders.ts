import scan from '../../../data/demos/__ROOM__/scan.json';
import type { Part } from '../part';
import { placeholder } from '../placeholder';

/** RoomPlan boxes for every detected object; delete this file once the areas model them */
export default async function placeholders(): Promise<Part> {
  return { room: scan.objects.map((_, i) => placeholder(i)) };
}
