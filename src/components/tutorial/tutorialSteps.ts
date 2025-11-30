export interface TutorialStep {
  id: string;
  target?: string;  // CSS selector for element to highlight
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  emoji?: string;
}

export const compareTutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Parlay Compare! ⚖️',
    description: 'Compare up to 4 parlays and find your best bet using Monte Carlo simulation.',
    position: 'center',
    emoji: '👋',
  },
  {
    id: 'first-slot',
    target: '[data-tutorial="parlay-slot-0"]',
    title: 'Add Your First Parlay',
    description: 'Upload a screenshot, type manually, or select from your history.',
    position: 'bottom',
    emoji: '📤',
  },
  {
    id: 'upload',
    target: '[data-tutorial="upload-button"]',
    title: 'AI-Powered Scanning',
    description: 'Our AI reads your bet slip and extracts all legs automatically.',
    position: 'bottom',
    emoji: '🤖',
  },
  {
    id: 'manual',
    target: '[data-tutorial="manual-button"]',
    title: 'Manual Entry',
    description: 'Prefer typing? Add your legs and odds manually.',
    position: 'bottom',
    emoji: '✏️',
  },
  {
    id: 'history',
    target: '[data-tutorial="history-button"]',
    title: 'Use Saved Parlays',
    description: 'Pull from your previous bets for quick comparison.',
    position: 'bottom',
    emoji: '📚',
  },
  {
    id: 'add-more',
    target: '[data-tutorial="add-slot"]',
    title: 'Add More Parlays',
    description: 'Compare up to 4 parlays at once to find the best value.',
    position: 'top',
    emoji: '➕',
  },
  {
    id: 'compare',
    target: '[data-tutorial="compare-button"]',
    title: 'Run the Simulation',
    description: '10,000 Monte Carlo simulations will find your best bet!',
    position: 'top',
    emoji: '🎰',
  },
];

export const uploadTutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Analyze Your Parlay 🎯',
    description: 'Upload a screenshot and get instant AI analysis of your bet.',
    position: 'center',
    emoji: '👋',
  },
  {
    id: 'upload',
    target: '[data-tutorial="upload-area"]',
    title: 'Upload Your Slip',
    description: 'Take a screenshot of your bet slip and upload it here.',
    position: 'bottom',
    emoji: '📸',
  },
  {
    id: 'results',
    title: 'Get Your Results',
    description: 'See win probability, expected value, and AI roasts!',
    position: 'center',
    emoji: '📊',
  },
];

export const suggestionsTutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'AI Parlay Suggestions 🤖',
    description: 'Get AI-powered parlay recommendations based on real odds data.',
    position: 'center',
    emoji: '✨',
  },
  {
    id: 'confidence',
    target: '[data-tutorial="confidence-badge"]',
    title: 'Confidence Score',
    description: 'Higher confidence means better value based on our analysis.',
    position: 'bottom',
    emoji: '🎯',
  },
  {
    id: 'follow',
    target: '[data-tutorial="follow-button"]',
    title: 'Follow a Pick',
    description: 'Tap to add this suggestion to your parlay history.',
    position: 'top',
    emoji: '👆',
  },
];
