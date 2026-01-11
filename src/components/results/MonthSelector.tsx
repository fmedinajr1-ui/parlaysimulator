import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useArchiveMonths } from "@/hooks/useArchiveResults";

interface MonthSelectorProps {
  selectedMonth: Date;
  onMonthChange: (month: Date) => void;
}

export function MonthSelector({ selectedMonth, onMonthChange }: MonthSelectorProps) {
  const { data: availableMonths } = useArchiveMonths();
  
  const currentMonthStr = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');

  // Generate list of last 12 months for selection
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(startOfMonth(date), 'yyyy-MM-dd'),
      label: format(date, 'MMMM yyyy'),
    };
  });

  const handlePrevMonth = () => {
    onMonthChange(subMonths(selectedMonth, 1));
  };

  const handleNextMonth = () => {
    const nextMonth = new Date(selectedMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    if (nextMonth <= new Date()) {
      onMonthChange(nextMonth);
    }
  };

  const handleSelectMonth = (value: string) => {
    onMonthChange(parseISO(value));
  };

  const isCurrentMonth = format(selectedMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM');

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevMonth}
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Select value={currentMonthStr} onValueChange={handleSelectMonth}>
        <SelectTrigger className="w-[180px] h-9">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map((option) => {
            const hasData = availableMonths?.includes(option.value);
            return (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  <span>{option.label}</span>
                  {hasData && (
                    <span className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleNextMonth}
        disabled={isCurrentMonth}
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
