import Image from "next/image";

import type { Mood } from "@/lib/types";

const moodAvatarSources: Record<Mood, string> = {
  happy: "/api/avatars/happy",
  sad: "/api/avatars/sad",
};

interface MoodAvatarProps {
  mood: Mood;
  size: number;
  className?: string;
}

export function MoodAvatar({ mood, size, className = "" }: MoodAvatarProps) {
  return (
    <Image
      className={`mood-avatar mood-avatar--${mood} ${className}`.trim()}
      src={moodAvatarSources[mood]}
      alt=""
      width={size}
      height={size}
      unoptimized
      aria-hidden="true"
      draggable={false}
    />
  );
}
