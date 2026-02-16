# TimelineTree YearSection Re-render Optimization

## Problem Statement

Previously, when the `expandedMonths` or `expandedPostsMonths` Sets were updated (toggling any month), **all** `YearSection` components would re-render because:

1. The parent component (`TimelineTree`) creates a new Set reference when toggling
2. React.memo's default shallow comparison sees a different Set reference
3. All `YearSection` components re-render, even if their specific months weren't affected

While the `MonthSection` components are also memoized (preventing deeper re-renders), the `YearSection` components still executed their render logic and reconciliation process.

## Solution

Added a custom comparison function to `YearSection`'s `React.memo` that:

1. Checks if primitive props changed (year data, isExpanded, highlightedPostId, etc.)
2. **Only checks expansion state for months within that specific year**
3. Returns `true` (skip re-render) if none of the relevant months changed
4. Returns `false` (re-render) only if months within that year changed

## Implementation

```typescript
const YearSection = React.memo(({
  // ... props
}, (prevProps, nextProps) => {
  // Check primitive/stable props first
  if (
    prevProps.yearData !== nextProps.yearData ||
    prevProps.isExpanded !== nextProps.isExpanded ||
    // ... other props
  ) {
    return false; // Props changed, re-render
  }

  // Check if expansion state changed for months within THIS year only
  const { year, months } = nextProps.yearData;
  for (const monthData of months) {
    const yearMonth = `${year}-${monthData.month}`;
    const prevMonthExpanded = prevProps.expandedMonths.has(yearMonth);
    const nextMonthExpanded = nextProps.expandedMonths.has(yearMonth);
    const prevShowAllPosts = prevProps.expandedPostsMonths.has(yearMonth);
    const nextShowAllPosts = nextProps.expandedPostsMonths.has(yearMonth);

    if (prevMonthExpanded !== nextMonthExpanded || prevShowAllPosts !== nextShowAllPosts) {
      return false; // Month state changed, re-render
    }
  }

  return true; // No relevant changes, skip re-render
});
```

## Benefits

1. **Reduced CPU usage**: Only the relevant YearSection re-renders when a month is toggled
2. **Better performance**: Especially noticeable with many years of archive data
3. **Surgical updates**: Changes are localized to the affected year only
4. **Maintained functionality**: All existing behavior preserved

## Example Scenario

Given archives for 2022, 2023, and 2024:

### Before Optimization
- User toggles "January 2024"
- All 3 YearSection components re-render
- MonthSection memoization prevents deeper re-renders

### After Optimization
- User toggles "January 2024"
- **Only** the 2024 YearSection re-renders
- 2022 and 2023 YearSection components skip re-render
- MonthSection memoization still provides additional safety

## Testing Recommendations

To verify the optimization:

1. **Add React DevTools Profiler instrumentation**:
   ```typescript
   // Add console.log in YearSection render function (temporarily)
   console.log(`YearSection ${yearData.year} rendering`);
   ```

2. **Manual testing**:
   - Open the timeline page with multiple years
   - Open React DevTools Profiler
   - Toggle a month in one year
   - Verify only that year's component re-renders

3. **Expected behavior**:
   - Toggling month → only that year re-renders
   - Toggling year → only that year re-renders
   - Highlighting post → all years re-render (expected, global state)

## Performance Considerations

- The custom comparison function has O(n) complexity where n = number of months in a year (max 12)
- This is negligible compared to the render cost of React components
- The optimization provides net positive performance benefit

## Related Code

- Component: `apps/blog/app/components/TimelineTree.tsx`
- Lines: 202-320 (YearSection with custom comparison)
- Parent state management: Lines 298-420 (toggle handlers)
