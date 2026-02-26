import type { ConnectedAccountPublic } from "../../lib";

interface AccountAvatarProps {
  account: ConnectedAccountPublic;
  size?: number;
}

export function AccountAvatar({ account, size = 32 }: AccountAvatarProps) {
  const color = account.color || "#6d86d3";
  const nameStr = account.name || account.email.split("@")[0];
  const initials = nameStr.slice(0, 2).toUpperCase();

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
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}18`,
        color: color,
        fontSize: size * 0.36,
      }}
    >
      {initials}
    </div>
  );
}
