import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBlogs, useContentProject } from '../../hooks/useCms';
import { Can } from '../../components/auth/Can';
import { Plus, Edit, Eye, FileText, LayoutTemplate, Zap, Inbox } from 'lucide-react';

export default function ProjectBlogsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  
  const { data: blogs, isLoading } = useBlogs(projectId!, selectedStatus === 'all' ? undefined : selectedStatus);
  const { data: project } = useContentProject(projectId!);
  const handleCreateBlog = () => {
    navigate(`/cms/projects/${projectId}/blogs/create`);
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/cms', { state: { selectProjectId: projectId } })}
            className="mb-4 text-brand-600 hover:text-brand-800"
          >
            &larr; Back to {project?.name ?? 'project'}
          </button>
          <h1 className="text-2xl font-bold">Blog Management</h1>
          <p className="text-gray-600">Manage blog content for this project</p>
        </div>
        
        <div className="flex gap-3">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2"
          >
            <option value="all">All Blogs</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>

          <button
            onClick={() => navigate(`/cms/projects/${projectId}/content-engine`)}
            className="bg-white border border-brand-300 text-brand-700 px-4 py-2 rounded hover:bg-brand-50 flex items-center"
          >
            <Zap className="w-4 h-4 mr-2" />
            Content Engine
          </button>

          <button
            onClick={() => navigate(`/cms/projects/${projectId}/leads`)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 flex items-center"
          >
            <Inbox className="w-4 h-4 mr-2" />
            Leads
          </button>

          <button
            onClick={() => navigate(`/cms/projects/${projectId}/templates`)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 flex items-center"
          >
            <LayoutTemplate className="w-4 h-4 mr-2" />
            Templates
          </button>
          
          <Can permission="cms.blog.create">
            <button
              onClick={handleCreateBlog}
              className="bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700 flex items-center"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Blog
            </button>
          </Can>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {blogs?.map((blog: any) => (
          <div key={blog.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
            <div className="p-6">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-semibold flex-1">{blog.title}</h3>
                <span className={`px-2 py-1 rounded text-xs ${
                  blog.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' :
                  blog.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {blog.status}
                </span>
              </div>
              
              {blog.excerpt && (
                <p className="text-gray-600 mb-4 line-clamp-3">{blog.excerpt}</p>
              )}
              
              <div className="flex justify-between text-sm text-gray-500 mb-4">
                <span>By {blog.author?.name}</span>
                <span>{new Date(blog.createdAt).toLocaleDateString()}</span>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/cms/projects/${projectId}/blogs/${blog.id}`)}
                  className="flex-1 bg-brand-600 text-white px-3 py-2 rounded text-sm hover:bg-brand-700 flex items-center justify-center"
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Edit
                </button>
                
                <button
                  onClick={() => navigate(`/cms/projects/${projectId}/blogs/${blog.id}/preview`)}
                  className="flex-1 bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 flex items-center justify-center"
                >
                  <Eye className="w-3 h-3 mr-1" />
                  View
                </button>
              </div>
            </div>
          </div>
        ))}

        {blogs?.length === 0 && (
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <FileText className="w-16 h-16 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Blogs Found</h3>
              <p>Create your first blog to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
