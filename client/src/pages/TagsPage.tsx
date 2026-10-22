import TagSection from '../components/TagSection';
import './Page.css';
import './TagsPage.css';

export default function TagsPage() {
  return (
    <div className="page page-enter tags-page" aria-labelledby="page-title">
      <h1 id="page-title" className="page-title">
        标签管理
      </h1>
      <p className="page-hint">在这里新建、重命名或删除标签；点标签名可查看关联笔记。</p>
      <TagSection />
    </div>
  );
}
