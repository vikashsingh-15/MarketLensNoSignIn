import type { RecommendationValue } from '../types';
export function RecommendationBadge({ value }: { value: RecommendationValue }) { return <span className={`badge badge-${value.toLowerCase()}`}>{value}</span>; }
