import classNames from 'classnames';
import { as } from 'folds';
import * as css from './Sidebar.css';

export const Sidebar = as<'div'>(({ as: AsSidebar = 'div', className, ...props }, ref) => (
  <AsSidebar className={classNames('Sidebar', css.Sidebar, className)} {...props} ref={ref} />
));
