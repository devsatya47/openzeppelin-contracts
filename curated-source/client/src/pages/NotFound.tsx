import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';

export default function NotFound({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <Page className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="eyebrow mb-6">{forbidden ? '403' : '404'}</div>
      <h1 className="text-5xl sm:text-6xl">{forbidden ? 'A private room' : 'This room is empty'}</h1>
      <p className="mt-4 max-w-md text-mute">
        {forbidden ? 'Your account does not have access to this area.' : 'The work or page you were looking for has moved or no longer exists.'}
      </p>
      <Link to="/gallery" className="btn-outline mt-10">Return to the gallery</Link>
    </Page>
  );
}
