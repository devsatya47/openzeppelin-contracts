import { Link } from 'react-router-dom';
import { Page } from '../../components/Layout';
import { OrderRow } from '../../components/OrderRow';
import { Empty, SectionHeading, Spinner } from '../../components/ui';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import type { Order } from '../../lib/types';

export default function Orders() {
  useDocumentTitle('My acquisitions');
  const { data, loading } = useApi<{ orders: Order[] }>('/orders');
  return (
    <Page className="py-12">
      <SectionHeading eyebrow="Your collection" title="My acquisitions" />
      {loading ? (
        <Spinner />
      ) : !data?.orders.length ? (
        <Empty title="No acquisitions yet">
          <Link to="/gallery" className="text-gold">Enter the gallery</Link> to find your first piece.
        </Empty>
      ) : (
        <div className="border-t border-line">{data.orders.map((o) => <OrderRow key={o.id} order={o} />)}</div>
      )}
    </Page>
  );
}
