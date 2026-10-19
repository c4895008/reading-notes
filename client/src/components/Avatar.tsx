import type { Avatar as AvatarData } from '../api/auth';
import PresetArt from './presetArt';
import './Avatar.css';

type Props = { avatar: AvatarData; name: string; size?: 24 | 32 | 40 | 64; decorative?: boolean };

export default function Avatar({ avatar, name, size = 32, decorative = false }: Props) {
  const label = decorative ? undefined : `${name}的头像`;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative || undefined}
    >
      {avatar.type === 'custom' ? <img src={avatar.url} alt="" /> : <PresetArt preset={avatar.preset} />}
    </span>
  );
}
