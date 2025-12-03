import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ExampleCard } from "./ExampleCard";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function ExampleCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true,
    align: 'center',
    skipSnaps: false,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  const cards: Array<'roast' | 'meter' | 'highlight'> = ['roast', 'meter', 'highlight'];

  return (
    <div className="relative mb-5">
      {/* Carousel container */}
      <div className="overflow-hidden rounded-2xl" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {cards.map((type, index) => (
            <div 
              key={type} 
              className="flex-[0_0_92%] min-w-0 pl-2 first:pl-0"
            >
              <ExampleCard type={type} delay={index * 50} />
            </div>
          ))}
        </div>
      </div>

      {/* Navigation buttons - hidden on mobile, visible on larger screens */}
      <button
        onClick={scrollPrev}
        disabled={!canScrollPrev}
        className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 w-8 h-8 items-center justify-center rounded-full bg-card border border-border text-foreground disabled:opacity-30 transition-opacity hover:bg-muted"
        aria-label="Previous example"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={scrollNext}
        disabled={!canScrollNext}
        className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 w-8 h-8 items-center justify-center rounded-full bg-card border border-border text-foreground disabled:opacity-30 transition-opacity hover:bg-muted"
        aria-label="Next example"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Dots indicator */}
      <div className="flex justify-center gap-2 mt-3">
        {cards.map((_, index) => (
          <button
            key={index}
            onClick={() => emblaApi?.scrollTo(index)}
            className={`w-2 h-2 rounded-full transition-all duration-200 ${
              index === selectedIndex 
                ? 'bg-primary w-4' 
                : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
            }`}
            aria-label={`Go to example ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
