export interface AccuracyData {
  category: string;
  subcategory: string;
  total_predictions: number;
  verified_predictions: number;
  correct_predictions: number;
  accuracy_rate: number;
  sample_confidence: string;
}

export interface CategoryStats {
  category: string;
  displayName: string;
  icon: string;
  totalPredictions: number;
  verifiedPredictions: number;
  correctPredictions: number;
  accuracyRate: number;
  grade: string;
  gradeColor: string;
  sampleConfidence: string;
  subcategories: AccuracyData[];
}

export interface CompositeScore {
  overallGrade: string;
  overallAccuracy: number;
  totalVerified: number;
  gradeColor: string;
  categories: CategoryStats[];
  bestPerformers: { name: string; accuracy: number; grade: string }[];
  worstPerformers: { name: string; accuracy: number; grade: string }[];
  recommendations: { type: 'trust' | 'caution' | 'avoid' | 'needs_data'; message: string }[];
}

const CATEGORY_DISPLAY_NAMES: Record<string, { name: string; icon: string }> = {
  sharp_money: { name: 'Sharp Money', icon: '⚡' },
  upset_predictions: { name: 'Upset Predictions', icon: '🎯' },
  ai_performance: { name: 'AI Performance', icon: '🧠' },
  fatigue_edge: { name: 'Fatigue Edge', icon: '🔋' },
  trap_patterns: { name: 'Trap Patterns', icon: '🪤' },
  suggestions: { name: 'Suggestions', icon: '💡' }
};

export function calculateGrade(accuracy: number, sampleSize: number): { grade: string; color: string } {
  // Must have minimum samples for reliable grade
  if (sampleSize < 10) {
    return { grade: 'N/A', color: 'text-muted-foreground' };
  }
  
  if (accuracy >= 60 && sampleSize >= 100) {
    return { grade: 'A+', color: 'text-green-400' };
  } else if (accuracy >= 55 && sampleSize >= 50) {
    return { grade: 'A', color: 'text-green-500' };
  } else if (accuracy >= 52 && sampleSize >= 50) {
    return { grade: 'B+', color: 'text-emerald-500' };
  } else if (accuracy >= 50 && sampleSize >= 25) {
    return { grade: 'B', color: 'text-yellow-500' };
  } else if (accuracy >= 47 && sampleSize >= 25) {
    return { grade: 'C+', color: 'text-orange-400' };
  } else if (accuracy >= 45) {
    return { grade: 'C', color: 'text-orange-500' };
  } else if (accuracy >= 40) {
    return { grade: 'D', color: 'text-red-400' };
  } else {
    return { grade: 'F', color: 'text-red-500' };
  }
}

export function aggregateCategoryStats(data: AccuracyData[]): CategoryStats[] {
  const categoryMap = new Map<string, AccuracyData[]>();
  
  data.forEach(item => {
    const existing = categoryMap.get(item.category) || [];
    existing.push(item);
    categoryMap.set(item.category, existing);
  });
  
  const categories: CategoryStats[] = [];
  
  categoryMap.forEach((subcategories, category) => {
    const totalPredictions = subcategories.reduce((sum, s) => sum + s.total_predictions, 0);
    const verifiedPredictions = subcategories.reduce((sum, s) => sum + s.verified_predictions, 0);
    const correctPredictions = subcategories.reduce((sum, s) => sum + s.correct_predictions, 0);
    const accuracyRate = verifiedPredictions > 0 
      ? Math.round((correctPredictions / verifiedPredictions) * 1000) / 10 
      : 0;
    
    const { grade, color } = calculateGrade(accuracyRate, verifiedPredictions);
    const displayInfo = CATEGORY_DISPLAY_NAMES[category] || { name: category, icon: '📊' };
    
    // Determine overall sample confidence
    let sampleConfidence = 'insufficient';
    if (verifiedPredictions >= 100) sampleConfidence = 'high';
    else if (verifiedPredictions >= 50) sampleConfidence = 'medium';
    else if (verifiedPredictions >= 20) sampleConfidence = 'low';
    
    categories.push({
      category,
      displayName: displayInfo.name,
      icon: displayInfo.icon,
      totalPredictions,
      verifiedPredictions,
      correctPredictions,
      accuracyRate,
      grade,
      gradeColor: color,
      sampleConfidence,
      subcategories
    });
  });
  
  return categories.sort((a, b) => b.verifiedPredictions - a.verifiedPredictions);
}

export function calculateCompositeScore(data: AccuracyData[]): CompositeScore {
  const categories = aggregateCategoryStats(data);
  
  // Calculate weighted average (weight by verified predictions)
  let weightedSum = 0;
  let totalWeight = 0;
  
  categories.forEach(cat => {
    if (cat.verifiedPredictions >= 10) {
      weightedSum += cat.accuracyRate * cat.verifiedPredictions;
      totalWeight += cat.verifiedPredictions;
    }
  });
  
  const overallAccuracy = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;
  const totalVerified = categories.reduce((sum, c) => sum + c.verifiedPredictions, 0);
  const { grade: overallGrade, color: gradeColor } = calculateGrade(overallAccuracy, totalVerified);
  
  // Find best and worst performers (with sufficient samples)
  const validCategories = categories.filter(c => c.verifiedPredictions >= 20);
  
  const bestPerformers = [...validCategories]
    .sort((a, b) => b.accuracyRate - a.accuracyRate)
    .slice(0, 3)
    .map(c => ({ name: c.displayName, accuracy: c.accuracyRate, grade: c.grade }));
  
  const worstPerformers = [...validCategories]
    .sort((a, b) => a.accuracyRate - b.accuracyRate)
    .slice(0, 3)
    .filter(c => c.accuracyRate < 52.4) // Only show if below breakeven
    .map(c => ({ name: c.displayName, accuracy: c.accuracyRate, grade: c.grade }));
  
  // Generate recommendations
  const recommendations: CompositeScore['recommendations'] = [];
  
  categories.forEach(cat => {
    if (cat.verifiedPredictions < 20) {
      recommendations.push({
        type: 'needs_data',
        message: `${cat.displayName} needs ${20 - cat.verifiedPredictions} more verified picks for reliable rating`
      });
    } else if (cat.accuracyRate >= 55) {
      recommendations.push({
        type: 'trust',
        message: `${cat.displayName} (${cat.accuracyRate}%) - High performing, consider increasing stake`
      });
    } else if (cat.accuracyRate >= 50 && cat.accuracyRate < 52.4) {
      recommendations.push({
        type: 'caution',
        message: `${cat.displayName} (${cat.accuracyRate}%) - Near breakeven, needs improvement`
      });
    } else if (cat.accuracyRate < 45) {
      recommendations.push({
        type: 'avoid',
        message: `${cat.displayName} (${cat.accuracyRate}%) - Underperforming, consider fading`
      });
    }
  });
  
  // Sort recommendations by type priority
  const typePriority = { avoid: 0, caution: 1, trust: 2, needs_data: 3 };
  recommendations.sort((a, b) => typePriority[a.type] - typePriority[b.type]);
  
  return {
    overallGrade,
    overallAccuracy,
    totalVerified,
    gradeColor,
    categories,
    bestPerformers,
    worstPerformers,
    recommendations
  };
}
