import type { RecommendationValue } from '../types';

export type ConsensusFilterValue = 'ALL' | RecommendationValue;

const options: ConsensusFilterValue[] = ['ALL', 'BUY', 'HOLD', 'SELL'];

export function ConsensusFilter({ value, onChange }: {
  value: ConsensusFilterValue;
  onChange: (value: ConsensusFilterValue) => void;
}) {
  return <div className="rating-filter" aria-label="Filter hot stocks by consensus">
    {options.map((option) => <button type="button" key={option} className={value === option ? `active ${option.toLowerCase()}` : ''} aria-pressed={value === option} onClick={() => onChange(option)}>{option === 'ALL' ? 'All' : option}</button>)}
  </div>;
}
