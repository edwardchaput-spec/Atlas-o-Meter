import { Sparkles, Star } from "lucide-react";

import { MoodAvatar } from "@/components/mood-avatar";

export function HappyCelebration({ starEarned }: { starEarned: boolean }) {
  return (
    <div className="happy-celebration" aria-hidden="true">
      <div className="happy-celebration__ring" />
      <div className="happy-celebration__face">
        <MoodAvatar mood="happy" size={176} />
      </div>
      <Sparkles className="happy-spark happy-spark--one" size={27} />
      <Star
        className="happy-spark happy-spark--two"
        size={25}
        fill="currentColor"
      />
      <Sparkles className="happy-spark happy-spark--three" size={22} />
      {starEarned ? (
        <div className="happy-celebration__star">
          <Star size={34} fill="currentColor" />
        </div>
      ) : null}
    </div>
  );
}
