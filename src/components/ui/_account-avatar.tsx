import type { ConnectedAccountPublic } from "../../lib";

interface AccountAvatarProps {
  account: ConnectedAccountPublic;
  size?: number;
}

export function AccountAvatar({ account, size = 32 }: AccountAvatarProps) {
  const color = account.color || "#6d86d3";
  const nameStr = account.name || account.email;
  const parts = nameStr.split(/[\s@]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : nameStr.slice(0, 2).toUpperCase();

  if (account.photoUrl) {
    return (
      <img
        src={account.photoUrl}
        alt={account.name || account.email}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: size * 0.36,
      }}
    >
      {initials}
    </div>
  );
}
