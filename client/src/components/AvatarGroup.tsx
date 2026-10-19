import type { PublicUser } from '../api/auth';
import Avatar from './Avatar';
import './AvatarGroup.css';

type Props = { users: PublicUser[]; max: number; size?: 24 | 32 };

// 发起人在前由数据保证；超出部分折成 +n
export default function AvatarGroup({ users, max, size = 24 }: Props) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className={`avatar-group is-${size}`} role="img" aria-label={`${users.length} 位参与者：${users.map((u) => u.nickname).join('、')}`}>
      {shown.map((u) => (
        <Avatar key={u.user_id} avatar={u.avatar} name={u.nickname} size={size} decorative />
      ))}
      {rest > 0 && (
        <span className="avatar-more" aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}
