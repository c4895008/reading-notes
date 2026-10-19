import { Link } from 'react-router-dom';
import './Page.css';

export default function NotFound() {
  return (
    <section className="page page-enter page-center" aria-labelledby="nf-title">
      <p className="nf-mark" aria-hidden="true">
        404
      </p>
      <h1 id="nf-title" className="page-title">
        找不到这一页
      </h1>
      <p className="page-hint">无权访问或不存在。</p>
      <Link to="/notes" className="btn btn-primary">
        回到笔记
      </Link>
    </section>
  );
}
