import type { GptPlanFilter, Sub2ApiGptValidityResponse, Sub2ApiPlanType } from '../types';

export const GPT_PLAN_FILTER_OPTIONS: Array<{ label: string; value: GptPlanFilter }> = [
  { label: '全部GPT', value: '' },
  { label: 'Plus', value: 'plus' },
  { label: 'Free', value: 'free' },
  { label: 'Team', value: 'team' },
  { label: '空', value: 'empty' }
];

export function formatGptPlanLabel(planType: Sub2ApiPlanType): string {
  if (planType === 'plus') {
    return 'Plus';
  }

  if (planType === 'free' || planType === '') {
    return 'Free';
  }

  if (planType === 'team') {
    return 'Team';
  }

  return '';
}

export function resolveGptValidityLabel(result: Sub2ApiGptValidityResponse | null | undefined): string {
  if (result?.valid !== true) {
    return '';
  }

  return formatGptPlanLabel(result.planType) || 'GPT有效';
}
