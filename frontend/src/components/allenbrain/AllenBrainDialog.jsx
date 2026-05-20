import React from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AllenBrainApp from './AllenBrainApp';
import ABCLOGO from '../../assets/DataRepository/abc_logo.png';

const HEADER_BG = 'rgb(22, 62, 101)';

function AllenBrainHeader() {
  return (
    <Box
      sx={{
        bgcolor: HEADER_BG,
        px: 3,
        minHeight: 130,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <img src={ABCLOGO} alt="Allen Brain Cell Types" style={{ height: 70, width: 70, objectFit: 'contain' }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <Typography
          variant="h5"
          component="span"
          sx={{ color: '#fff', fontWeight: 700, letterSpacing: 1 }}
        >
          Allen Brain Cell Type
        </Typography>
      </Box>
    </Box>
  );
}

export default function AllenBrainDialog({ open, onClose, clientId, onFileChange }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      scroll="paper"
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: '90vh', borderRadius: 2 } }}
    >
      <DialogTitle sx={{ position: 'relative', p: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
        <a
          href="https://celltypes.brain-map.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <AllenBrainHeader />
        </a>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(255,255,255,0.15)', color: '#fff' }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          <AllenBrainApp
            clientId={clientId}
            onFileChange={onFileChange}
            onClose={onClose}
          />
        </Box>
      </DialogContent>

      <Typography
        variant="caption"
        sx={{ display: 'flex', justifyContent: 'center', gap: '6px', p: 1.5, color: 'text.secondary' }}
      >
        Data from the{' '}
        <a href="https://celltypes.brain-map.org" target="_blank" rel="noopener noreferrer">
          Allen Cell Types Database
        </a>
        {' '}· Allen Institute for Brain Science ·{' '}
        <a href="https://alleninstitute.org/legal/terms-use/" target="_blank" rel="noopener noreferrer">
          Terms of Use
        </a>
      </Typography>

    </Dialog>
  );
}
